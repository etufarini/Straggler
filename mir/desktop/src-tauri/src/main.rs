#[cfg(all(feature = "native-tests", not(debug_assertions)))]
compile_error!("Desktop automation must never be included in a release build.");

use mir_desktop::{
    default_data_dir, history::Conversation, ChatRequest, Configuration, JobStatus, Listener,
    Result, Runtime, Settings, Status,
};
use std::{path::PathBuf, sync::Arc};
use tauri::{ipc::Channel, Emitter, Manager, State};
use uuid::Uuid;

struct Application(Result<Arc<Runtime>>);

#[derive(serde::Serialize)]
struct Response {
    status: String,
    content: String,
    reasoning: String,
    error: Option<String>,
}

fn runtime(state: &State<'_, Application>) -> Result<Arc<Runtime>> {
    state.0.clone()
}

#[tauri::command]
async fn configuration(state: State<'_, Application>) -> Result<Configuration> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.inspect())
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn apply_settings(
    settings: Settings,
    state: State<'_, Application>,
) -> Result<Configuration> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.configure(settings))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn workspace_action(
    action: String,
    arguments: Vec<String>,
    targets: Vec<Listener>,
    state: State<'_, Application>,
) -> Result<serde_json::Value> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        runtime.workspace_action(&action, arguments, targets)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn start_build(
    tag: String,
    backend: String,
    jobs: String,
    state: State<'_, Application>,
) -> Result<()> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.start_build(tag, backend, jobs))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn job_status(state: State<'_, Application>) -> Result<JobStatus> {
    runtime(&state)?.job_status()
}

#[tauri::command]
async fn cancel_build(state: State<'_, Application>) -> Result<()> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.cancel_build())
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn start_server(model: String, state: State<'_, Application>) -> Result<()> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.start(model))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn stop_server(state: State<'_, Application>) -> Result<()> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.stop())
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn server_status(state: State<'_, Application>) -> Result<Status> {
    runtime(&state)?.status().await
}

#[tauri::command]
async fn generate(
    request: ChatRequest,
    on_delta: Channel<mir_desktop::stream::Delta>,
    state: State<'_, Application>,
) -> Result<Response> {
    let mut content = String::new();
    let mut reasoning = String::new();
    let result = runtime(&state)?
        .generate(request, |delta| {
            content.push_str(&delta.content);
            reasoning.push_str(&delta.reasoning);
            on_delta.send(delta).map_err(|e| e.to_string())
        })
        .await;
    let (status, error) = match result {
        Ok(status) => (status, None),
        Err(error) => ("error".into(), Some(error)),
    };
    // The final snapshot is authoritative even if IPC deltas are still queued.
    Ok(Response {
        status,
        content,
        reasoning,
        error,
    })
}

#[tauri::command]
fn cancel_generation(request_id: Uuid, state: State<'_, Application>) -> Result<()> {
    runtime(&state)?.cancel(request_id)
}

#[tauri::command]
async fn history_list(state: State<'_, Application>) -> Result<Vec<Conversation>> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.history.list())
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn history_save(conversation: Conversation, state: State<'_, Application>) -> Result<()> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.history.save(&conversation))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn history_delete(id: Uuid, state: State<'_, Application>) -> Result<()> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.history.delete(id))
        .await
        .map_err(|e| e.to_string())?
}

fn launcher(app: &tauri::App) -> Result<PathBuf> {
    if let Some(root) = std::env::var_os("MIR_ROOT") {
        return Ok(PathBuf::from(root).join("mir.sh"));
    }
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("launcher/mir.sh");
    if bundled.is_file() {
        return Ok(bundled);
    }
    #[cfg(debug_assertions)]
    {
        Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../mir.sh"))
    }
    #[cfg(not(debug_assertions))]
    Err("Bundled launcher is missing. Reinstall Mir.cpp desktop.".into())
}

fn shutdown_on_signals(handle: tauri::AppHandle, runtime: Arc<Runtime>) {
    tauri::async_runtime::spawn(async move {
        use tokio::signal::unix::{signal, SignalKind};
        let signals = (
            signal(SignalKind::terminate()),
            signal(SignalKind::interrupt()),
            signal(SignalKind::hangup()),
        );
        let (Ok(mut terminate), Ok(mut interrupt), Ok(mut hangup)) = signals else {
            let _ = handle.emit(
                "shutdown-error",
                "Could not register desktop shutdown signals.",
            );
            return;
        };
        loop {
            tokio::select! {
                _ = terminate.recv() => {},
                _ = interrupt.recv() => {},
                _ = hangup.recv() => {},
            }
            let runtime = runtime.clone();
            let result = tauri::async_runtime::spawn_blocking(move || {
                runtime.cancel_build()?;
                runtime.stop()
            })
            .await
            .map_err(|e| e.to_string())
            .and_then(|result| result);
            match result {
                Ok(()) => {
                    handle.exit(0);
                    break;
                }
                Err(error) => {
                    let _ = handle.emit("shutdown-error", error);
                }
            }
        }
    });
}

fn main() {
    let context = tauri::generate_context!();
    if std::env::args().nth(1).as_deref() == Some("--mir-check") {
        if cfg!(feature = "custom-protocol") && context.assets().get(&"index.html".into()).is_none()
        {
            eprintln!("The compiled desktop is missing its embedded interface.");
            std::process::exit(1);
        }
        println!("Mir.cpp desktop {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    let builder = tauri::Builder::default();
    #[cfg(all(feature = "native-tests", debug_assertions))]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    let app = builder
        .setup(|app| {
            let runtime = launcher(app)
                .and_then(|launcher| Runtime::new(launcher, default_data_dir()?))
                .map(Arc::new);
            if let Ok(runtime) = &runtime {
                shutdown_on_signals(app.handle().clone(), runtime.clone());
            }
            app.manage(Application(runtime));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            configuration,
            apply_settings,
            workspace_action,
            start_build,
            job_status,
            cancel_build,
            start_server,
            stop_server,
            server_status,
            generate,
            cancel_generation,
            history_list,
            history_save,
            history_delete
        ])
        .build(context)
        .expect("Could not start Mir.cpp desktop");
    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Ok(runtime) = &handle.state::<Application>().0 {
                let _ = runtime.cancel_build();
                let _ = runtime.stop();
            }
        }
    });
}
