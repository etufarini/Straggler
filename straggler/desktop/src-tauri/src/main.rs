#[cfg(all(feature = "native-tests", not(debug_assertions)))]
compile_error!("Desktop automation must never be included in a release build.");

#[cfg(feature = "packaging-probe")]
mod packaging_probe;

use std::{path::PathBuf, sync::Arc};
use straggler_desktop::{
    history::Conversation, ChatRequest, Configuration, Listener, Result, Runtime, Settings, Status,
};
use tauri::{ipc::Channel, Emitter, Manager, State};
use uuid::Uuid;

struct Application(Result<Arc<Runtime>>);

#[derive(serde::Serialize)]
struct Response {
    status: String,
    content: String,
    reasoning: String,
    error: Option<String>,
    metrics: Option<straggler_desktop::stream::GenerationMetrics>,
    sources: Vec<straggler_desktop::web_search::citations::Source>,
    #[serde(rename = "webSearch")]
    web_search: Option<straggler_desktop::web_search::turn::TurnSummary>,
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
async fn backend_release(
    state: State<'_, Application>,
) -> Result<straggler_desktop::backend_release::BackendRelease> {
    runtime(&state)?.backend_release().await
}

#[tauri::command]
async fn apply_settings(
    settings: Settings,
    state: State<'_, Application>,
) -> std::result::Result<Configuration, straggler_desktop::workspace::ConfigurationError> {
    let runtime =
        runtime(&state).map_err(straggler_desktop::workspace::ConfigurationError::from)?;
    tauri::async_runtime::spawn_blocking(move || runtime.configure(settings))
        .await
        .map_err(|e| e.to_string())
        .and_then(|result| result)
        .map_err(straggler_desktop::workspace::ConfigurationError::from)
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
async fn choose_models_folder(
    app: tauri::AppHandle,
    state: State<'_, Application>,
) -> Result<Option<Configuration>> {
    use tauri_plugin_dialog::DialogExt;
    let runtime = runtime(&state)?;
    #[cfg(target_os = "linux")]
    if straggler_desktop::platform::models_picker::requires_portal() {
        let selected = straggler_desktop::platform::models_picker::choose_folder().await?;
        return tauri::async_runtime::spawn_blocking(move || {
            selected
                .map(|path| runtime.select_model_folder(&path))
                .transpose()
        })
        .await
        .map_err(|error| error.to_string())?;
    }
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
async fn choose_model_file(
    kind: straggler_desktop::configuration::model_files::ModelFileKind,
    app: tauri::AppHandle,
    state: State<'_, Application>,
) -> Result<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    let runtime = runtime(&state)?;
    #[cfg(target_os = "linux")]
    if straggler_desktop::platform::models_picker::requires_portal() {
        let selected =
            straggler_desktop::platform::models_picker::choose_file(kind.title()).await?;
        return tauri::async_runtime::spawn_blocking(move || {
            selected
                .map(|path| runtime.select_model_file(kind, &path))
                .transpose()
        })
        .await
        .map_err(|error| error.to_string())?;
    }
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title(kind.title())
            .add_filter("Model file", &[kind.extension()])
            .add_filter("All files", &["*"])
            .blocking_pick_file()
            .map(|selected| {
                let path = selected.into_path().map_err(|error| error.to_string())?;
                runtime.select_model_file(kind, &path)
            })
            .transpose()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn create_models_folder(
    app: tauri::AppHandle,
    state: State<'_, Application>,
) -> Result<Configuration> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models");
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.create_models_folder(&directory))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn models_folder_info(
    app: tauri::AppHandle,
    state: State<'_, Application>,
) -> Result<serde_json::Value> {
    let default = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models");
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let config = runtime.inspect()?;
        let (free, error) = if config.models_dir.is_empty() { (None, None) } else {
            match straggler_desktop::platform::available_disk_bytes(std::path::Path::new(&config.models_dir)) {
                Ok(free) => (Some(free), None), Err(error) => (None, Some(error)),
            }
        };
        Ok(serde_json::json!({"path": config.models_dir, "defaultPath": default, "freeBytes": free, "error": error}))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn web_search_status(
    refresh: bool,
    state: State<'_, Application>,
) -> Result<straggler_desktop::web_search::SearchStatus> {
    let runtime = runtime(&state)?;
    let provider = runtime.preferences.read()?.web_search_provider;
    Ok(runtime.web_search.status(&provider, refresh).await)
}
#[tauri::command]
async fn web_search_key_save(
    key: Option<String>,
    state: State<'_, Application>,
) -> Result<straggler_desktop::web_search::SearchStatus> {
    let runtime = runtime(&state)?;
    let provider = runtime.preferences.read()?.web_search_provider;
    runtime.web_search.save_key(&provider, key).await
}
#[tauri::command]
async fn open_web_url(url: String) -> Result<()> {
    let url = straggler_desktop::external_links::sanitize(&url)?;
    tauri::async_runtime::spawn_blocking(move || {
        straggler_desktop::platform::open_web_url(url.as_str())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn hf_token_status(
    state: State<'_, Application>,
) -> Result<straggler_desktop::huggingface::TokenStatus> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.hugging_face.token_status())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn hf_token_save(
    token: Option<String>,
    state: State<'_, Application>,
) -> Result<straggler_desktop::huggingface::TokenStatus> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.hugging_face.save_token(token.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn hf_search(
    query: String,
    state: State<'_, Application>,
) -> Result<straggler_desktop::huggingface::api::SearchResults> {
    runtime(&state)?.hugging_face.search(&query).await
}

#[tauri::command]
async fn hf_repository(
    repository: String,
    revision: String,
    state: State<'_, Application>,
) -> Result<straggler_desktop::huggingface::api::Repository> {
    runtime(&state)?
        .hugging_face
        .repository(&repository, &revision)
        .await
}

#[tauri::command]
async fn hf_download_start(
    repository: String,
    revision: String,
    files: Vec<String>,
    state: State<'_, Application>,
) -> Result<Uuid> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        runtime.download_hf(&repository, &revision, &files)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn hf_downloads(
    state: State<'_, Application>,
) -> Result<Vec<straggler_desktop::huggingface::downloads::Download>> {
    runtime(&state)?.hugging_face.downloads.list()
}

#[tauri::command]
async fn hf_download_control(
    id: Uuid,
    action: String,
    state: State<'_, Application>,
) -> Result<()> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || match action.as_str() {
        "pause" => runtime.hugging_face.downloads.control(id, false),
        "cancel" => runtime.hugging_face.downloads.control(id, true),
        "resume" => runtime.resume_hf(id),
        _ => Err("Unknown download action.".into()),
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn hf_pause_all(state: State<'_, Application>) -> Result<()> {
    let runtime = runtime(&state)?;
    runtime.hugging_face.downloads.pause_all()?;
    for _ in 0..100 {
        if !runtime.hugging_face.downloads.is_active()? {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    Err("Downloads are still pausing. Wait a moment and retry closing.".into())
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
async fn temporary_begin(id: Uuid, state: State<'_, Application>) -> Result<()> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.begin_temporary(id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn temporary_finish(
    id: Uuid,
    conversation: Option<Conversation>,
    restart: bool,
    state: State<'_, Application>,
) -> Result<Option<String>> {
    let runtime = runtime(&state)?;
    let erase_failed = runtime.erase_temporary_slot(id).await.is_err();
    let warning = tauri::async_runtime::spawn_blocking(move || {
        runtime.finish_temporary(id, conversation, restart)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(warning.or_else(|| {
        erase_failed
            .then(|| "The temporary backend was stopped to clear its slot and RAM caches.".into())
    }))
}

#[tauri::command]
async fn temporary_attachment_add(
    id: Uuid,
    path: PathBuf,
    state: State<'_, Application>,
) -> Result<straggler_desktop::attachments::Attachment> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.temporary_attachment(id, &path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn temporary_attachment_remove(
    id: Uuid,
    attachment_id: Uuid,
    state: State<'_, Application>,
) -> Result<()> {
    runtime(&state)?.remove_temporary_attachment(id, attachment_id)
}

#[tauri::command]
async fn server_status(state: State<'_, Application>) -> Result<Status> {
    runtime(&state)?.status().await
}

#[tauri::command]
async fn server_details(
    state: State<'_, Application>,
) -> Result<straggler_desktop::model::ServerDetails> {
    runtime(&state)?.server_details().await
}

#[tauri::command]
async fn generate(
    request: ChatRequest,
    on_delta: Channel<straggler_desktop::stream::Delta>,
    app: tauri::AppHandle,
    state: State<'_, Application>,
) -> Result<Response> {
    let mut content = String::new();
    let mut reasoning = String::new();
    let mut metrics = straggler_desktop::stream::GenerationMetrics::default();
    let mut has_metrics = false;
    let mut sources = Vec::new();
    let mut web_search = None;
    let result = runtime(&state)?
        .generate(request, |delta| {
            if let Some(value) = &delta.metrics {
                metrics.merge(value);
                has_metrics = true;
            }
            if let Some(value) = &delta.sources {
                sources = value.clone();
            }
            if let Some(value) = &delta.web_search {
                web_search = Some(value.clone());
            }
            for event in &delta.web_events {
                app.emit(event.name, &event.payload)
                    .map_err(|e| e.to_string())?;
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
        sources,
        web_search,
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
        straggler_desktop::files::write_atomic(&path, contents.as_bytes())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn system_prompts_export(ids: Vec<Uuid>, state: State<'_, Application>) -> Result<String> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let presets = runtime.system_prompts.list()?;
        let selected = ids
            .iter()
            .map(|id| {
                presets
                    .iter()
                    .find(|preset| &preset.id == id)
                    .map(|preset| preset.content.clone())
                    .ok_or_else(|| "The preset no longer exists.".to_owned())
            })
            .collect::<Result<Vec<_>>>()?;
        straggler_desktop::system_prompts::export(selected)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn system_prompts_list(
    state: State<'_, Application>,
) -> Result<Vec<straggler_desktop::system_prompts::Preset>> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.system_prompts.list())
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn system_prompt_save(
    id: Option<Uuid>,
    preset: straggler_desktop::system_prompts::PresetText,
    state: State<'_, Application>,
) -> Result<Vec<straggler_desktop::system_prompts::Preset>> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.system_prompts.save(id, preset))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn system_prompt_delete(
    id: Uuid,
    state: State<'_, Application>,
) -> Result<Vec<straggler_desktop::system_prompts::Preset>> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.system_prompts.delete(id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn system_prompts_import(
    choices: Vec<straggler_desktop::system_prompts::ImportChoice>,
    state: State<'_, Application>,
) -> Result<Vec<straggler_desktop::system_prompts::Preset>> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.system_prompts.import(choices))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn system_prompts_read_import(
    path: PathBuf,
) -> Result<Vec<straggler_desktop::system_prompts::PresetText>> {
    tauri::async_runtime::spawn_blocking(move || {
        straggler_desktop::system_prompts::read_import(&path)
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
    runtime.ensure_persistent(conversation.id)?;
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
    messages: Vec<straggler_desktop::ChatMessage>,
    state: State<'_, Application>,
) -> Result<straggler_desktop::tokens::PromptTokens> {
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
) -> Result<straggler_desktop::conversation_import::ImportedConversation> {
    tauri::async_runtime::spawn_blocking(move || {
        straggler_desktop::conversation_import::read(&path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn history_create(conversation: Conversation, state: State<'_, Application>) -> Result<()> {
    let runtime = runtime(&state)?;
    runtime.ensure_persistent(conversation.id)?;
    tauri::async_runtime::spawn_blocking(move || runtime.history.create(&conversation))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn history_search_text(query: String, state: State<'_, Application>) -> Result<Vec<Uuid>> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.history.search_text(&query))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn history_branch(
    id: Uuid,
    message_id: Uuid,
    state: State<'_, Application>,
) -> Result<Conversation> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.branch_conversation(id, message_id))
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
) -> Result<Vec<straggler_desktop::projects::ProjectView>> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.projects.list(&runtime.history))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn attachment_search(
    id: Uuid,
    temporary: bool,
    query: String,
    budget: usize,
    state: State<'_, Application>,
) -> Result<Vec<straggler_desktop::project_search::Passage>> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        runtime.search_attachments(id, temporary, &query, budget)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn project_search(
    project_id: Uuid,
    query: String,
    budget: usize,
    state: State<'_, Application>,
) -> Result<Vec<straggler_desktop::project_search::Passage>> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        runtime
            .projects
            .search(&runtime.history, project_id, &query, budget)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn project_file_text(
    project_id: Uuid,
    file_id: Uuid,
    state: State<'_, Application>,
) -> Result<String> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        runtime
            .projects
            .file_text(&runtime.history, project_id, file_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn project_save(
    project: straggler_desktop::projects::Project,
    state: State<'_, Application>,
) -> Result<straggler_desktop::projects::ProjectMutation> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.save_project(project))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn project_file_add(
    project_id: Uuid,
    replace_file_id: Option<Uuid>,
    path: PathBuf,
    characters_per_token: usize,
    state: State<'_, Application>,
) -> Result<straggler_desktop::projects::ProjectMutation> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        runtime.projects.add_or_replace_file(
            &runtime.history,
            project_id,
            &path,
            characters_per_token,
            replace_file_id,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn project_file_remove(
    project_id: Uuid,
    file_id: Uuid,
    state: State<'_, Application>,
) -> Result<straggler_desktop::projects::ProjectMutation> {
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
) -> Result<straggler_desktop::projects::ProjectMutation> {
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
) -> Result<straggler_desktop::projects::ProjectMutation> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.delete_project(project_id, delete_chats))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn project_undo(
    token: Uuid,
    state: State<'_, Application>,
) -> Result<straggler_desktop::projects::ProjectMutation> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.undo_project(token))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn preferences_read(
    state: State<'_, Application>,
) -> Result<straggler_desktop::preferences::UiPreferences> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.preferences.read())
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn preferences_save(
    preferences: straggler_desktop::preferences::UiPreferences,
    state: State<'_, Application>,
) -> Result<()> {
    let runtime = runtime(&state)?;
    tauri::async_runtime::spawn_blocking(move || runtime.preferences.save(&preferences))
        .await
        .map_err(|e| e.to_string())?
}

fn native_environment() -> Result<straggler_desktop::configuration::environment::Environment> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let bundled = straggler_desktop::platform::bundled_server(&executable);
    straggler_desktop::configuration::environment::Environment::capture(bundled)
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
    if std::env::args().nth(1).as_deref() == Some("--straggler-check") {
        if cfg!(feature = "custom-protocol") && context.assets().get(&"index.html".into()).is_none()
        {
            eprintln!("The compiled desktop is missing its embedded interface.");
            std::process::exit(1);
        }
        println!("Straggler desktop {}", env!("CARGO_PKG_VERSION"));
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
                if let Ok(directory) = app.path().app_data_dir() {
                    let directory = directory.join("models");
                    let _ = runtime.allow_default_models_folder(
                        &directory.canonicalize().unwrap_or(directory),
                    );
                }
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
            backend_release,
            apply_settings,
            workspace_action,
            choose_models_folder,
            choose_model_file,
            create_models_folder,
            models_folder_info,
            web_search_status,
            web_search_key_save,
            open_web_url,
            hf_token_status,
            hf_token_save,
            hf_search,
            hf_repository,
            hf_download_start,
            hf_downloads,
            hf_download_control,
            hf_pause_all,
            start_server,
            stop_server,
            server_status,
            server_details,
            generate,
            cancel_generation,
            temporary_begin,
            temporary_finish,
            temporary_attachment_add,
            temporary_attachment_remove,
            write_export,
            system_prompts_list,
            system_prompts_export,
            system_prompt_save,
            system_prompt_delete,
            system_prompts_import,
            system_prompts_read_import,
            history_list,
            history_save,
            history_delete,
            history_create,
            history_branch,
            history_search_text,
            tokenize_text,
            prompt_tokens,
            attachment_add,
            attachment_remove,
            attachment_download,
            read_conversation_import,
            projects_list,
            project_save,
            project_search,
            attachment_search,
            project_file_text,
            project_file_add,
            project_file_remove,
            project_move_chat,
            project_delete,
            project_undo,
            preferences_read,
            preferences_save
        ])
        .build(context)
        .expect("Could not start Straggler desktop");
    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Ok(runtime) = &handle.state::<Application>().0 {
                let _ = runtime.shutdown();
            }
        }
    });
}
