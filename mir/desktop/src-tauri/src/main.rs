#[cfg(all(feature = "native-tests", not(debug_assertions)))]
compile_error!("Desktop automation must never be included in a release build.");

#[cfg(feature = "packaging-probe")]
mod packaging_probe;

use mir_desktop::{
    history::Conversation, ChatRequest, Configuration, Listener, Result, Runtime, Settings, Status,
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
    metrics: Option<mir_desktop::stream::GenerationMetrics>,
}

fn runtime(state: &State<'_, Application>) -> Result<Arc<Runtime>> {
    state.0.clone()
}

// Native automation needs an actual hidden window when a runner's window manager
// ignores minimize requests. This command is absent from production builds.
#[cfg(feature = "native-tests")]
#[tauri::command]
fn test_window_visibility(visible: bool, window: tauri::WebviewWindow) -> Result<()> {
    if visible {
        window.show()
    } else {
        window.hide()
    }
    .map_err(|e| e.to_string())
}

#[cfg(all(feature = "native-tests", debug_assertions))]
#[tauri::command]
fn test_data_dir(state: State<'_, Application>) -> Result<PathBuf> {
    Ok(runtime(&state)?.test_data_dir())
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
) -> std::result::Result<Configuration, mir_desktop::workspace::ConfigurationError> {
    let runtime = runtime(&state).map_err(mir_desktop::workspace::ConfigurationError::from)?;
    tauri::async_runtime::spawn_blocking(move || runtime.configure(settings))
        .await
        .map_err(|e| e.to_string())
        .and_then(|result| result)
        .map_err(mir_desktop::workspace::ConfigurationError::from)
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

#[cfg(feature = "app-store")]
#[tauri::command]
async fn choose_models_folder(
    app: tauri::AppHandle,
    state: State<'_, Application>,
) -> Result<Option<Configuration>> {
    use tauri_plugin_dialog::DialogExt;
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .set_title("Choose models folder")
            .blocking_pick_folder();
        selected
            .map(|selected| {
                let path = selected.into_path().map_err(|error| error.to_string())?;
                runtime.select_model_folder(&path)
            })
            .transpose()
    })
    .await
    .map_err(|error| error.to_string())?
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
async fn server_details(
    state: State<'_, Application>,
) -> Result<mir_desktop::model::ServerDetails> {
    runtime(&state)?.server_details().await
}

#[tauri::command]
async fn generate(
    request: ChatRequest,
    on_delta: Channel<mir_desktop::stream::Delta>,
    state: State<'_, Application>,
) -> Result<Response> {
    let mut content = String::new();
    let mut reasoning = String::new();
    let mut metrics = mir_desktop::stream::GenerationMetrics::default();
    let mut has_metrics = false;
    let result = runtime(&state)?
        .generate(request, |delta| {
            if let Some(value) = &delta.metrics {
                metrics.merge(value);
                has_metrics = true;
            }
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
        metrics: has_metrics.then_some(metrics),
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
async fn write_export(path: PathBuf, contents: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        mir_desktop::files::write_atomic(&path, contents.as_bytes())
    })
    .await
    .map_err(|e| e.to_string())?
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
async fn tokenize_text(content: String, state: State<'_, Application>) -> Result<usize> {
    runtime(&state)?.tokenize_text(&content).await
}

#[tauri::command]
async fn prompt_tokens(
    messages: Vec<mir_desktop::ChatMessage>,
    state: State<'_, Application>,
) -> Result<mir_desktop::tokens::PromptTokens> {
    runtime(&state)?.prompt_tokens(messages).await
}

#[tauri::command]
async fn attachment_add(
    id: Uuid,
    path: PathBuf,
    state: State<'_, Application>,
) -> Result<Conversation> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.history.add_attachment(id, &path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn attachment_remove(
    id: Uuid,
    attachment_id: Uuid,
    state: State<'_, Application>,
) -> Result<Conversation> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        runtime.history.remove_attachment(id, attachment_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn attachment_download(
    id: Uuid,
    attachment_id: Uuid,
    destination: PathBuf,
    state: State<'_, Application>,
) -> Result<()> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        runtime
            .history
            .download_attachment(id, attachment_id, &destination)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn read_conversation_import(
    path: PathBuf,
) -> Result<mir_desktop::conversation_import::ImportedConversation> {
    tauri::async_runtime::spawn_blocking(move || mir_desktop::conversation_import::read(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn history_create(conversation: Conversation, state: State<'_, Application>) -> Result<()> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.history.create(&conversation))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn history_delete(id: Uuid, state: State<'_, Application>) -> Result<()> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.delete_conversation(id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn projects_list(
    state: State<'_, Application>,
) -> Result<Vec<mir_desktop::projects::ProjectView>> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.projects.list(&runtime.history))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn project_save(
    project: mir_desktop::projects::Project,
    state: State<'_, Application>,
) -> Result<mir_desktop::projects::ProjectMutation> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.save_project(project))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn project_file_add(
    project_id: Uuid,
    path: PathBuf,
    characters_per_token: usize,
    state: State<'_, Application>,
) -> Result<mir_desktop::projects::ProjectMutation> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        runtime
            .projects
            .add_file(&runtime.history, project_id, &path, characters_per_token)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn project_file_remove(
    project_id: Uuid,
    file_id: Uuid,
    state: State<'_, Application>,
) -> Result<mir_desktop::projects::ProjectMutation> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        runtime
            .projects
            .remove_file(&runtime.history, project_id, file_id)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn project_move_chat(
    conversation_id: Uuid,
    project_id: Option<Uuid>,
    state: State<'_, Application>,
) -> Result<mir_desktop::projects::ProjectMutation> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        runtime.move_project_chat(conversation_id, project_id)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn project_delete(
    project_id: Uuid,
    delete_chats: bool,
    state: State<'_, Application>,
) -> Result<mir_desktop::projects::ProjectMutation> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.delete_project(project_id, delete_chats))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn project_undo(
    token: Uuid,
    state: State<'_, Application>,
) -> Result<mir_desktop::projects::ProjectMutation> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.undo_project(token))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn preferences_read(
    state: State<'_, Application>,
) -> Result<mir_desktop::preferences::UiPreferences> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.preferences.read())
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn preferences_save(
    preferences: mir_desktop::preferences::UiPreferences,
    state: State<'_, Application>,
) -> Result<()> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.preferences.save(&preferences))
        .await
        .map_err(|e| e.to_string())?
}

fn native_environment() -> Result<mir_desktop::configuration::environment::Environment> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let bundled = executable.parent().and_then(|directory| {
        let adjacent = directory.join("mir-llama-server");
        if adjacent.is_file() {
            return Some(adjacent);
        }
        #[cfg(target_os = "linux")]
        {
            let packaged = directory.join("../lib/mir.cpp/backend/llama-server");
            if packaged.is_file() {
                return Some(packaged);
            }
        }
        None
    });
    mir_desktop::configuration::environment::Environment::capture(bundled)
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
            let result = tauri::async_runtime::spawn_blocking(move || runtime.shutdown())
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
    if cfg!(feature = "packaging-probe") {
        #[cfg(feature = "packaging-probe")]
        packaging_probe::run(context);
        return;
    }
    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());
    #[cfg(all(feature = "native-tests", debug_assertions))]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    let app = builder
        .setup(|app| {
            let runtime = native_environment()
                .and_then(|environment| {
                    let data = environment.data.join("desktop");
                    Runtime::new(environment, data)
                })
                .map(Arc::new);
            if let Ok(runtime) = &runtime {
                shutdown_on_signals(app.handle().clone(), runtime.clone());
            }
            app.manage(Application(runtime));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            #[cfg(feature = "native-tests")]
            test_window_visibility,
            #[cfg(feature = "native-tests")]
            test_data_dir,
            configuration,
            apply_settings,
            workspace_action,
            #[cfg(feature = "app-store")]
            choose_models_folder,
            start_server,
            stop_server,
            server_status,
            server_details,
            generate,
            cancel_generation,
            write_export,
            history_list,
            history_save,
            history_delete,
            history_create,
            tokenize_text,
            prompt_tokens,
            attachment_add,
            attachment_remove,
            attachment_download,
            read_conversation_import,
            projects_list,
            project_save,
            project_file_add,
            project_file_remove,
            project_move_chat,
            project_delete,
            project_undo,
            preferences_read,
            preferences_save
        ])
        .build(context)
        .expect("Could not start Mir.cpp desktop");
    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Ok(runtime) = &handle.state::<Application>().0 {
                let _ = runtime.shutdown();
            }
        }
    });
}
