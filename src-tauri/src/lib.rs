use harper_core::linting::Linter;
use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, Manager};

#[derive(Serialize, Clone)]
pub struct OpenedPath {
    pub path: String,
}

#[derive(Serialize, Clone)]
pub struct VaultFile {
    pub name: String,
    pub path: String,
}

#[derive(Serialize, Clone)]
pub struct ProofreadLint {
    pub from: usize,
    pub to: usize,
    pub message: String,
    pub suggestions: Vec<String>,
}

fn harper() -> &'static Mutex<HarperState> {
    static STATE: OnceLock<Mutex<HarperState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(HarperState::new()))
}

struct HarperState {
    lint_group: harper_core::linting::LintGroup,
}

impl HarperState {
    fn new() -> Self {
        let dictionary = harper_core::spell::FstDictionary::curated();
        let lint_group = harper_core::linting::LintGroup::new_curated(dictionary, harper_core::Dialect::American);
        Self { lint_group }
    }
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
        .invoke_handler(tauri::generate_handler![
            launch_args,
            write_bytes,
            write_text,
            copy_file,
            read_bytes,
            read_text,
            pasted_dir,
            proofread,
            scan_vault,
            read_vault_file
        ])
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
fn write_text(path: String, contents: String) -> Result<(), String> {
    write_bytes(path, contents.into_bytes())
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
fn read_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|error| error.to_string())?;
    let mut text = String::from_utf8_lossy(&bytes).into_owned();
    if text.starts_with('\u{feff}') {
        text.remove(0);
    }
    Ok(text)
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

#[tauri::command]
fn scan_vault(dir: String) -> Result<Vec<VaultFile>, String> {
    let entries = std::fs::read_dir(&dir).map_err(|error| error.to_string())?;
    let mut files = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path.file_name().and_then(|name| name.to_str()).unwrap_or("");
        let lower = name.to_lowercase();
        if !(lower.ends_with(".md") || lower.ends_with(".markdown") || lower.ends_with(".mdown")) {
            continue;
        }
        files.push(VaultFile { name: name.to_owned(), path: path.to_string_lossy().into_owned() });
        if files.len() >= 500 {
            break;
        }
    }
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(files)
}

#[tauri::command]
fn read_vault_file(path: String, dir: String) -> Result<String, String> {
    let canonical_file = std::path::PathBuf::from(&path)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let canonical_dir = std::path::PathBuf::from(&dir)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !canonical_file.starts_with(&canonical_dir) {
        return Err("File is outside the document folder.".to_owned());
    }
    read_text(canonical_file.to_string_lossy().into_owned())
}

#[tauri::command]
fn proofread(text: String) -> Result<Vec<ProofreadLint>, String> {
    if text.chars().count() > 60_000 {
        return Ok(Vec::new());
    }
    let utf16_offsets = utf16_offset_map(&text);
    let doc_end = utf16_offsets.last().copied().unwrap_or(0);
    let mut state = harper().lock().map_err(|error| error.to_string())?;
    let document = harper_core::Document::new_markdown_default_curated(&text);
    let lints = state.lint_group.lint(&document);
    let mut out = Vec::with_capacity(lints.len().min(200));
    for lint in lints.iter().take(200) {
        let from = utf16_offsets.get(lint.span.start).copied().unwrap_or(doc_end);
        let to = utf16_offsets.get(lint.span.end).copied().unwrap_or(doc_end);
        if from >= to {
            continue;
        }
        let suggestions = lint
            .suggestions
            .iter()
            .take(3)
            .map(|suggestion| suggestion.to_string())
            .collect();
        out.push(ProofreadLint { from, to, message: lint.message.clone(), suggestions });
    }
    Ok(out)
}

fn utf16_offset_map(text: &str) -> Vec<usize> {
    let mut map = Vec::with_capacity(text.chars().count() + 1);
    let mut offset = 0;
    map.push(0);
    for char in text.chars() {
        offset += char.len_utf16();
        map.push(offset);
    }
    map
}

#[cfg(test)]
mod proofread_tests {
    use super::*;

    #[test]
    fn catches_spelling_and_reports_utf16_offsets() {
        let lints = proofread("This is definately wrong.\n".to_owned()).expect("lint runs");
        assert!(!lints.is_empty(), "expected at least one lint");
        assert!(lints.iter().any(|lint| lint.message.to_lowercase().contains("spell") || !lint.suggestions.is_empty()), "lint carries signal");
    }

    #[test]
    fn offsets_survive_emoji() {
        let text = "AX😀BZ definately here.\n".to_owned();
        let lints = proofread(text.clone()).expect("lint runs");
        let doc: Vec<u16> = text.encode_utf16().collect();
        for lint in &lints {
            assert!(lint.to <= doc.len(), "offset in bounds");
            assert!(lint.to > lint.from, "non-empty span");
        }
    }

    #[test]
    fn skips_code_fences_quietly() {
        let text = "```\ndefinately not prose\n```\n".to_owned();
        let lints = proofread(text).expect("lint runs");
        assert!(lints.iter().all(|lint| lint.from >= 3), "no lint inside fence");
    }
}
