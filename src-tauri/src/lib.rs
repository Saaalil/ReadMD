use serde::Serialize;
use tauri::{Emitter, Manager};

#[derive(Serialize, Clone)]
pub struct OpenedPath {
    pub path: String,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A second launch (e.g. double-clicking a file) forwards its file
            // arguments to the running instance and focuses the window.
            if let Some(path) = argv.iter().skip(1).find(|arg| !arg.starts_with('-')) {
                let _ = app.emit("readmd://open-file", OpenedPath { path: path.clone() });
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![launch_args, write_bytes, copy_file, read_bytes, pasted_dir])
        .setup(|app| {
            // File opened via double-click / "Open with" at first launch.
            if let Some(path) = std::env::args().skip(1).find(|arg| !arg.starts_with('-')) {
                let _ = app.emit("readmd://open-file", OpenedPath { path });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run readmd");
}

#[tauri::command]
fn launch_args() -> Vec<String> {
    std::env::args().skip(1).collect()
}

#[tauri::command]
fn write_bytes(path: String, contents: Vec<u8>) -> Result<(), String> {
    let path = std::path::PathBuf::from(path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(&path, contents).map_err(|error| error.to_string())
}

#[tauri::command]
fn copy_file(from: String, to: String) -> Result<(), String> {
    let to = std::path::PathBuf::from(&to);
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::copy(&from, &to).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn pasted_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("pasted");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}
