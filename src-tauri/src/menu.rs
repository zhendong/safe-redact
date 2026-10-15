//! Native menu bar, localized to match the language chosen in the app.

use std::sync::Mutex;

use tauri::menu::{AboutMetadata, Menu, MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, State, Wry};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::open_path;

const SUPPORTED_EXTENSIONS: [&str; 6] = ["pdf", "docx", "png", "jpg", "jpeg", "webp"];
const REPO_URL: &str = "https://github.com/zhendong/safe-redact";

#[derive(Clone, Copy, PartialEq)]
pub enum Language {
    En,
    Zh,
}

struct Labels {
    about: &'static str,
    services: &'static str,
    hide: &'static str,
    hide_others: &'static str,
    show_all: &'static str,
    quit: &'static str,
    file: &'static str,
    open: &'static str,
    save_redacted: &'static str,
    close_window: &'static str,
    edit: &'static str,
    undo: &'static str,
    redo: &'static str,
    cut: &'static str,
    copy: &'static str,
    paste: &'static str,
    select_all: &'static str,
    view: &'static str,
    full_screen: &'static str,
    window: &'static str,
    minimize: &'static str,
    zoom: &'static str,
    help: &'static str,
    github: &'static str,
    report_issue: &'static str,
    file_filter: &'static str,
}

const EN: Labels = Labels {
    about: "About SafeRedact",
    services: "Services",
    hide: "Hide SafeRedact",
    hide_others: "Hide Others",
    show_all: "Show All",
    quit: "Quit SafeRedact",
    file: "File",
    open: "Open…",
    save_redacted: "Save Redacted File…",
    close_window: "Close Window",
    edit: "Edit",
    undo: "Undo",
    redo: "Redo",
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    select_all: "Select All",
    view: "View",
    full_screen: "Enter Full Screen",
    window: "Window",
    minimize: "Minimize",
    zoom: "Zoom",
    help: "Help",
    github: "SafeRedact on GitHub",
    report_issue: "Report an Issue…",
    file_filter: "PDF, Word Documents, and Images",
};

// Wording follows the standard macOS Simplified Chinese menus
const ZH: Labels = Labels {
    about: "关于 SafeRedact",
    services: "服务",
    hide: "隐藏 SafeRedact",
    hide_others: "隐藏其他",
    show_all: "全部显示",
    quit: "退出 SafeRedact",
    file: "文件",
    open: "打开…",
    save_redacted: "存储脱敏文件…",
    close_window: "关闭窗口",
    edit: "编辑",
    undo: "撤销",
    redo: "重做",
    cut: "剪切",
    copy: "拷贝",
    paste: "粘贴",
    select_all: "全选",
    view: "显示",
    full_screen: "进入全屏幕",
    window: "窗口",
    minimize: "最小化",
    zoom: "缩放",
    help: "帮助",
    github: "在 GitHub 上查看 SafeRedact",
    report_issue: "报告问题…",
    file_filter: "PDF、Word 文档和图片",
};

fn labels(language: Language) -> &'static Labels {
    match language {
        Language::En => &EN,
        Language::Zh => &ZH,
    }
}

pub struct MenuState {
    language: Mutex<Language>,
    export_enabled: Mutex<bool>,
    export_item: Mutex<Option<MenuItem<Wry>>>,
}

impl Default for MenuState {
    fn default() -> Self {
        Self {
            language: Mutex::new(Language::En),
            export_enabled: Mutex::new(false),
            export_item: Mutex::new(None),
        }
    }
}

fn build_menu(app: &AppHandle, l: &Labels, export_enabled: bool) -> tauri::Result<(Menu<Wry>, MenuItem<Wry>)> {
    let about = AboutMetadata {
        name: Some("SafeRedact".into()),
        website: Some(REPO_URL.into()),
        website_label: Some("GitHub".into()),
        license: Some("MIT".into()),
        ..Default::default()
    };
    let app_menu = SubmenuBuilder::new(app, "SafeRedact")
        .item(&PredefinedMenuItem::about(app, Some(l.about), Some(about))?)
        .separator()
        .item(&PredefinedMenuItem::services(app, Some(l.services))?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some(l.hide))?)
        .item(&PredefinedMenuItem::hide_others(app, Some(l.hide_others))?)
        .item(&PredefinedMenuItem::show_all(app, Some(l.show_all))?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some(l.quit))?)
        .build()?;

    let export = MenuItemBuilder::with_id("export", l.save_redacted)
        .accelerator("CmdOrCtrl+S")
        .enabled(export_enabled)
        .build(app)?;
    let file_menu = SubmenuBuilder::new(app, l.file)
        .item(&MenuItemBuilder::with_id("open", l.open).accelerator("CmdOrCtrl+O").build(app)?)
        .item(&export)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, Some(l.close_window))?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, l.edit)
        .item(&PredefinedMenuItem::undo(app, Some(l.undo))?)
        .item(&PredefinedMenuItem::redo(app, Some(l.redo))?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some(l.cut))?)
        .item(&PredefinedMenuItem::copy(app, Some(l.copy))?)
        .item(&PredefinedMenuItem::paste(app, Some(l.paste))?)
        .item(&PredefinedMenuItem::select_all(app, Some(l.select_all))?)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, l.view)
        .item(&PredefinedMenuItem::fullscreen(app, Some(l.full_screen))?)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, l.window)
        .item(&PredefinedMenuItem::minimize(app, Some(l.minimize))?)
        .item(&PredefinedMenuItem::maximize(app, Some(l.zoom))?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, Some(l.close_window))?)
        .build()?;

    let help_menu = SubmenuBuilder::new(app, l.help)
        .item(&MenuItemBuilder::with_id("help-github", l.github).build(app)?)
        .item(&MenuItemBuilder::with_id("help-issue", l.report_issue).build(app)?)
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu, &help_menu])
        .build()?;
    Ok((menu, export))
}

/// Builds the menu for the current language and installs it.
pub fn install_menu(app: &AppHandle) -> tauri::Result<()> {
    let state = app.state::<MenuState>();
    let language = *state.language.lock().unwrap();
    let export_enabled = *state.export_enabled.lock().unwrap();
    let (menu, export) = build_menu(app, labels(language), export_enabled)?;
    app.set_menu(menu)?;
    *state.export_item.lock().unwrap() = Some(export);
    Ok(())
}

pub fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        "open" => {
            let language = *app.state::<MenuState>().language.lock().unwrap();
            let handle = app.clone();
            app.dialog()
                .file()
                .add_filter(labels(language).file_filter, &SUPPORTED_EXTENSIONS)
                .pick_file(move |file| {
                    if let Some(path) = file.and_then(|f| f.into_path().ok()) {
                        open_path(&handle, path);
                    }
                });
        }
        "export" => {
            let _ = app.emit("menu-export", ());
        }
        "help-github" => {
            let _ = app.opener().open_url(REPO_URL, None::<&str>);
        }
        "help-issue" => {
            let _ = app.opener().open_url(format!("{REPO_URL}/issues/new"), None::<&str>);
        }
        _ => {}
    }
}

/// Called by the frontend whenever the user switches the app language.
#[tauri::command]
pub fn set_language(app: AppHandle, language: String, state: State<MenuState>) -> Result<(), String> {
    let language = if language == "zh" { Language::Zh } else { Language::En };
    if *state.language.lock().unwrap() == language {
        return Ok(());
    }
    *state.language.lock().unwrap() = language;
    install_menu(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_export_enabled(enabled: bool, state: State<MenuState>) -> Result<(), String> {
    *state.export_enabled.lock().unwrap() = enabled;
    match state.export_item.lock().unwrap().as_ref() {
        Some(item) => item.set_enabled(enabled).map_err(|e| e.to_string()),
        None => Ok(()),
    }
}
