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
        .invoke_handler(tauri::generate_handler![launch_args])
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
