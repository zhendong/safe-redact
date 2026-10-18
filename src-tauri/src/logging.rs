//! Rotating log files for bug reports.
//!
//! Logs are written to the app's log directory (on macOS,
//! ~/Library/Logs/io.github.zhendong.saferedact). They must never contain
//! document content or file paths, since users attach them to public issues.

use std::path::PathBuf;

use log::LevelFilter;
use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};
use tauri_plugin_opener::OpenerExt;

const LOG_FILE_NAME: &str = "SafeRedact";
const MAX_FILE_BYTES: u128 = 2 * 1024 * 1024;
/// The current file plus rotated ones; also the most `read_logs` returns.
const KEEP_FILES: usize = 3;
/// Frontend entries are logged with this target prefix, e.g. `webview::PdfParser`.
const WEBVIEW_TARGET: &str = "webview";

pub fn plugin() -> TauriPlugin<Wry> {
    let level = if cfg!(debug_assertions) { LevelFilter::Debug } else { LevelFilter::Info };
    tauri_plugin_log::Builder::new()
        .targets([
            Target::new(TargetKind::Stdout),
            Target::new(TargetKind::LogDir { file_name: Some(LOG_FILE_NAME.into()) }),
        ])
        .max_file_size(MAX_FILE_BYTES)
        .rotation_strategy(RotationStrategy::KeepSome(KEEP_FILES))
        .timezone_strategy(TimezoneStrategy::UseLocal)
        // Third-party crates (tao, wry, …) only at warn so they don't drown out the app
        .level(LevelFilter::Warn)
        .level_for("safe_redact_lib", level)
        // The frontend filters its own entries (see src/utils/logger.ts)
        .level_for(WEBVIEW_TARGET, LevelFilter::Debug)
        .build()
}

/// Records panics in the log file before the default hook prints them.
pub fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let backtrace = std::backtrace::Backtrace::force_capture();
        log::error!("panic: {info}\n{backtrace}");
        default_hook(info);
    }));
}

pub fn log_startup(app: &AppHandle) {
    let info = app.package_info();
    log::info!(
        "SafeRedact {} starting (os={} {} arch={} tauri={} webview={})",
        info.version,
        std::env::consts::OS,
        os_version(),
        std::env::consts::ARCH,
        tauri::VERSION,
        tauri::webview_version().unwrap_or_else(|_| "unknown".into()),
    );
}

#[cfg(target_os = "macos")]
fn os_version() -> String {
    std::process::Command::new("sw_vers")
        .arg("-productVersion")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|version| version.trim().to_owned())
        .unwrap_or_default()
}

#[cfg(not(target_os = "macos"))]
fn os_version() -> String {
    String::new()
}

fn log_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_log_dir().map_err(|e| e.to_string())
}

/// Writes a frontend log entry to the log file. See src/utils/logger.ts.
#[tauri::command]
pub fn log_frontend(level: String, scope: String, message: String) {
    let level = match level.as_str() {
        "error" => log::Level::Error,
        "warn" => log::Level::Warn,
        "info" => log::Level::Info,
        _ => log::Level::Debug,
    };
    log::log!(target: &format!("{WEBVIEW_TARGET}::{scope}"), level, "{message}");
}

/// Returns the log files, oldest first, for the diagnostic report.
#[tauri::command]
pub fn read_logs(app: AppHandle) -> Result<String, String> {
    let dir = log_dir(&app)?;
    let current = format!("{LOG_FILE_NAME}.log");
    let mut rotated: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy())
                .is_some_and(|name| name.starts_with(&format!("{LOG_FILE_NAME}_")) && name.ends_with(".log"))
        })
        .collect();
    // Rotated files are named by date, so name order is age order
    rotated.sort();
    rotated.push(dir.join(current));

    let mut logs = String::new();
    for path in rotated {
        let Ok(contents) = std::fs::read(&path) else { continue };
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        logs.push_str(&format!("===== {name} =====\n"));
        logs.push_str(&String::from_utf8_lossy(&contents));
        if !logs.ends_with('\n') {
            logs.push('\n');
        }
    }
    Ok(logs)
}

/// Shows the log folder in Finder so users can attach the files themselves.
#[tauri::command]
pub fn reveal_logs(app: AppHandle) -> Result<(), String> {
    let dir = log_dir(&app)?;
    let current = dir.join(format!("{LOG_FILE_NAME}.log"));
    let target = if current.exists() { current } else { dir };
    app.opener().reveal_item_in_dir(target).map_err(|e| e.to_string())
}
