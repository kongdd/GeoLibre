const COMMANDS: &[&str] = &["capture_photo", "pick_photos", "open_photo", "read_photo"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .try_build()
        .unwrap();
}
