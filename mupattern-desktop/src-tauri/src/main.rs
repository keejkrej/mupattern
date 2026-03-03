#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            backend::workspace::workspace_state_load,
            backend::workspace::workspace_state_save,
            backend::workspace::pick_directory,
            backend::workspace::workspace_path_exists,
            backend::workspace::workspace_rescan_directory,
            backend::workspace::workspace_pick_tags_file,
            backend::workspace::workspace_save_bbox_csv,
            backend::workspace::workspace_read_position_image,
            backend::zarr_api::zarr_discover,
            backend::zarr_api::zarr_load_frame,
            backend::zarr_api::zarr_has_masks,
            backend::zarr_api::zarr_load_mask_frame,
            backend::zarr_api::zarr_pick_masks_dir,
            backend::tasks::tasks_pick_nd2_input,
            backend::tasks::tasks_pick_crops_destination,
            backend::tasks::tasks_pick_convert_output,
            backend::tasks::tasks_pick_expression_output,
            backend::tasks::tasks_pick_tissue_model,
            backend::tasks::tasks_pick_tissue_output,
            backend::tasks::tasks_pick_kill_model,
            backend::tasks::tasks_pick_movie_output,
            backend::tasks::tasks_pick_spots_file,
            backend::tasks::tasks_has_bbox_csv,
            backend::tasks::tasks_plan_convert,
            backend::tasks::tasks_plan_crop,
            backend::tasks::tasks_plan_expression_analyze,
            backend::tasks::tasks_plan_kill_predict,
            backend::tasks::tasks_plan_tissue_analyze,
            backend::tasks::tasks_plan_movie,
            backend::tasks::tasks_run_convert,
            backend::tasks::tasks_start_convert,
            backend::tasks::tasks_start_crop,
            backend::tasks::tasks_start_expression_analyze,
            backend::tasks::tasks_start_kill_predict,
            backend::tasks::tasks_start_tissue_analyze,
            backend::tasks::tasks_start_movie,
            backend::tasks::tasks_run_crop,
            backend::tasks::tasks_run_expression_analyze,
            backend::tasks::tasks_run_kill_predict,
            backend::tasks::tasks_run_tissue_analyze,
            backend::tasks::tasks_run_movie,
            backend::tasks::tasks_insert_task,
            backend::tasks::tasks_update_task,
            backend::tasks::tasks_list_tasks,
            backend::tasks::tasks_delete_completed_tasks,
            backend::application::application_list_expression_csv,
            backend::application::application_load_expression_csv,
            backend::application::application_list_kill_csv,
            backend::application::application_load_kill_csv,
            backend::application::application_list_tissue_csv,
            backend::application::application_load_tissue_csv,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
