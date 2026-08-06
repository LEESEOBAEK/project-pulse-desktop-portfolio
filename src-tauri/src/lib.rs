pub mod mock_cleanup;
pub mod scan;
pub mod window_layout;

use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let interaction = Arc::new(window_layout::InteractionState::default());

    tauri::Builder::default()
        .manage(mock_cleanup::CleanupState::default())
        .manage(interaction.clone())
        .invoke_handler(tauri::generate_handler![
            scan::temp_files::scan_temp_files,
            scan::startup::list_startup_items,
            scan::processes::list_processes,
            scan::services::list_services,
            scan::scheduled_tasks::list_scheduled_tasks,
            mock_cleanup::start_mock_cleanup,
            mock_cleanup::cancel_cleanup,
            window_layout::set_panel_open,
            window_layout::set_character_press_active,
        ])
        .setup(move |app| {
            let window = app
                .get_webview_window("main")
                .expect("main window should exist");
            window_layout::place_bottom_right(&window)?;
            window_layout::spawn_cursor_watcher(window, interaction.clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
