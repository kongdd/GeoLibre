const COMMANDS: &[&str] = &["capture_photo", "pick_photos", "read_photo"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .try_build()
        .unwrap();
}
