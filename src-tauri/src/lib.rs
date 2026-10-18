use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tauri_plugin_dialog::DialogExt;

mod menu;
mod ner;

#[derive(Clone, Serialize)]
struct OpenedFile {
    path: String,
    name: String,
}

/// Files opened from the menu, the Dock icon, or Finder's "Open With".
/// The frontend may only read paths the user opened through one of these.
#[derive(Default)]
struct OpenedFiles {
    allowed: Mutex<HashSet<PathBuf>>,
    /// Opened before the frontend was listening (e.g. a cold launch via "Open With")
    pending: Mutex<Option<OpenedFile>>,
    frontend_ready: Mutex<bool>,
}

/// Lets the frontend read this path through `read_opened_file`.
fn allow_path(app: &AppHandle, path: PathBuf) -> Option<OpenedFile> {
    let name = path.file_name()?.to_string_lossy().into_owned();
    let file = OpenedFile { path: path.to_string_lossy().into_owned(), name };
    app.state::<OpenedFiles>().allowed.lock().unwrap().insert(path);
    Some(file)
}

pub(crate) fn open_path(app: &AppHandle, path: PathBuf) {
    let Some(file) = allow_path(app, path) else {
        return;
    };
    let state = app.state::<OpenedFiles>();

    if *state.frontend_ready.lock().unwrap() {
        let _ = app.emit("open-file", file);
    } else {
        *state.pending.lock().unwrap() = Some(file);
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Called once the frontend listens for "open-file"; returns a file opened before that.
#[tauri::command]
fn take_pending_file(state: State<OpenedFiles>) -> Option<OpenedFile> {
    *state.frontend_ready.lock().unwrap() = true;
    state.pending.lock().unwrap().take()
}

/// Native Open dialog limited to the given extensions (WebKit's file input ignores `accept`).
#[tauri::command]
async fn pick_file(app: AppHandle, filter_name: String, extensions: Vec<String>) -> Option<OpenedFile> {
    let extensions: Vec<&str> = extensions.iter().map(String::as_str).collect();
    let path = app
        .dialog()
        .file()
        .add_filter(filter_name, &extensions)
        .blocking_pick_file()?
        .into_path()
        .ok()?;
    allow_path(&app, path)
}

#[tauri::command]
fn read_opened_file(path: String, state: State<OpenedFiles>) -> Result<Response, String> {
    let path = PathBuf::from(path);
    if !state.allowed.lock().unwrap().contains(&path) {
        return Err("File was not opened by the user".into());
    }
    std::fs::read(&path).map(Response::new).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(OpenedFiles::default())
        .manage(menu::MenuState::default())
        .manage(ner::NerModel::default())
        .setup(|app| {
            menu::install_menu(app.handle())?;
            Ok(())
        })
        .on_menu_event(|app, event| menu::handle_menu_event(app, event.id().as_ref()))
        .invoke_handler(tauri::generate_handler![
            take_pending_file,
            pick_file,
            read_opened_file,
            menu::set_export_enabled,
            menu::set_language,
            ner::ner_load,
            ner::ner_run
        ])
        .build(tauri::generate_context!())
        .expect("error while building SafeRedact");

    app.run(|app, event| {
        // Files dropped on the Dock icon or opened with "Open With" in Finder
        #[cfg(target_os = "macos")]
        if let RunEvent::Opened { urls } = event {
            // The app works on one document at a time
            if let Some(path) = urls.into_iter().find_map(|url| url.to_file_path().ok()) {
                open_path(app, path);
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
}
