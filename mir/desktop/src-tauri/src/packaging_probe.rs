//! A build-time diagnostic mode of the desktop executable, with no shell bridge.

use mir_desktop::{bundled_backend, files, Result};
use serde_json::json;
use std::{
    fs,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

async fn inspect(app: &tauri::AppHandle, cancelled: &AtomicBool) -> Result<serde_json::Value> {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    if arguments.iter().any(|arg| {
        !matches!(
            arg.as_str(),
            "--select-model" | "--no-dialog" | "--allow-force-stop"
        )
    }) {
        return Err(
            "Packaging check options: --select-model, --no-dialog, --allow-force-stop.".into(),
        );
    }
    let no_dialog = arguments.iter().any(|arg| arg == "--no-dialog");
    let allow_force = arguments.iter().any(|arg| arg == "--allow-force-stop");
    if no_dialog && arguments.iter().any(|arg| arg == "--select-model") {
        return Err("Model selection requires the native file dialog.".into());
    }
    let server =
        bundled_backend::bundled_server(&std::env::current_exe().map_err(|e| e.to_string())?)?;
    let provenance = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("backend-provenance.json");
    let provenance_bytes = fs::read(&provenance).map_err(|error| {
        format!(
            "Cannot read bundled backend provenance {}: {error}",
            provenance.display()
        )
    })?;
    let provenance: serde_json::Value = serde_json::from_slice(&provenance_bytes)
        .map_err(|error| format!("Invalid bundled backend provenance: {error}"))?;
    let commit = provenance["commit"]
        .as_str()
        .filter(|value| value.len() == 40 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or("The bundled backend provenance has no valid source commit.")?;
    let mut confirm_force = |pid| {
        if allow_force {
            return true;
        }
        if no_dialog {
            eprintln!("Backend PID {pid} has not stopped after SIGTERM. Waiting; SIGKILL needs --allow-force-stop.");
            return false;
        }
        app.dialog().message(format!("The owned backend (PID {pid}) has not stopped after SIGTERM. Send SIGKILL? Declining keeps waiting for its exit."))
            .title("Force stop backend?")
            .buttons(MessageDialogButtons::OkCancelCustom("Send SIGKILL".into(), "Keep waiting".into()))
            .blocking_show()
    };
    let mut checks = Vec::new();
    for flag in ["--version", "--help"] {
        let mut check = bundled_backend::check_command(
            &server,
            flag,
            cancelled,
            Duration::from_secs(30),
            &mut confirm_force,
        )
        .await;
        if flag == "--version" && check.success && !check.logs.contains(&commit[..7]) {
            check.success = false;
            check.error =
                Some("The bundled backend does not report the pinned source commit.".into());
        }
        let success = check.success;
        checks.push(check);
        if !success {
            break;
        }
    }
    let mut selection_cancelled = false;
    if checks.iter().all(|check| check.success)
        && !cancelled.load(Ordering::Relaxed)
        && arguments.iter().any(|arg| arg == "--select-model")
    {
        let selected = app
            .dialog()
            .file()
            .set_title("Select a GGUF for the optional CPU loading check")
            .add_filter("GGUF model", &["gguf"])
            .blocking_pick_file();
        match selected {
            Some(selected) => {
                let model = selected.into_path().map_err(|e| e.to_string())?;
                checks.push(
                    bundled_backend::check_model(
                        &server,
                        &model,
                        cancelled,
                        Duration::from_secs(120),
                        &mut confirm_force,
                    )
                    .await,
                );
            }
            None => selection_cancelled = true,
        }
    }
    Ok(json!({
        "purpose": "Local packaging diagnostic; not App Store approval or inference validation",
        "backend": provenance,
        "success": checks.iter().all(|check| check.success) && !selection_cancelled && !cancelled.load(Ordering::Relaxed),
        "cancelled": cancelled.load(Ordering::Relaxed),
        "selectionCancelled": selection_cancelled,
        "modelCheckRequested": arguments.iter().any(|arg| arg == "--select-model"),
        "checks": checks,
    }))
}

pub fn run(context: tauri::Context<tauri::Wry>) {
    let cancelled = Arc::new(AtomicBool::new(false));
    let finished = Arc::new(AtomicBool::new(false));
    let worker_cancel = cancelled.clone();
    let worker_finished = finished.clone();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let handle = app.handle().clone();
            let signal_cancel = worker_cancel.clone();
            let (mut terminate, mut interrupt, mut hangup) = tauri::async_runtime::block_on(async {
                use tokio::signal::unix::{signal, SignalKind};
                Ok::<_, std::io::Error>((
                    signal(SignalKind::terminate())?,
                    signal(SignalKind::interrupt())?,
                    signal(SignalKind::hangup())?,
                ))
            })?;
            tauri::async_runtime::spawn(async move {
                tokio::select! { _ = terminate.recv() => {}, _ = interrupt.recv() => {}, _ = hangup.recv() => {} }
                signal_cancel.store(true, Ordering::Relaxed);
            });
            // Blocking native dialogs run away from the application event loop.
            std::thread::spawn(move || {
                let result = tauri::async_runtime::block_on(inspect(&handle, &worker_cancel));
                let mut report =
                    result.unwrap_or_else(|error| json!({"success": false, "error": error}));
                let saved = (|| -> Result<_> {
                    let directory = handle.path().app_data_dir().map_err(|e| e.to_string())?;
                    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
                    let path = directory.join("backend-check.json");
                    files::write_atomic(
                        &path,
                        &serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?,
                    )?;
                    Ok(path)
                })();
                let message = match saved {
                    Ok(path) => format!(
                        "Backend check {}. Report: {}",
                        if report["success"] == true {
                            "passed"
                        } else {
                            "failed or cancelled"
                        },
                        path.display()
                    ),
                    Err(error) => {
                        report["success"] = json!(false);
                        report["storageError"] = json!(&error);
                        format!("Cannot save the packaging report: {error}")
                    }
                };
                let success = report["success"] == true;
                println!("{report}");
                eprintln!("{message}");
                if !std::env::args().any(|arg| arg == "--no-dialog") && !worker_cancel.load(Ordering::Relaxed) {
                    handle
                        .dialog()
                        .message(message)
                        .title("Mir.cpp backend packaging check")
                        .blocking_show();
                }
                worker_finished.store(true, Ordering::Relaxed);
                handle.exit(if success { 0 } else { 1 });
            });
            Ok(())
        })
        .build(context)
        .expect("Could not start the backend packaging check");
    app.run(move |handle, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if !finished.load(Ordering::Relaxed) {
                api.prevent_exit();
                let cancelled = cancelled.clone();
                handle
                    .dialog()
                    .message("Cancel the packaging check and stop its backend process?")
                    .title("Cancel backend check?")
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "Cancel check".into(),
                        "Continue check".into(),
                    ))
                    .show(move |confirmed| {
                        if confirmed {
                            cancelled.store(true, Ordering::Relaxed);
                        }
                    });
            }
        }
    });
}
