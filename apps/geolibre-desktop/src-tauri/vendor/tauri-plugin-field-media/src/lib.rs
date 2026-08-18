use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, PluginApi, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaPhoto {
    pub uri: String,
    pub name: String,
    pub mime_type: String,
    pub bearing: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct CaptureResponse {
    photo: Option<MediaPhoto>,
}

#[derive(Debug, Deserialize)]
struct PickResponse {
    photos: Vec<MediaPhoto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadResponse {
    data_url: String,
}

#[derive(Serialize)]
struct PickArgs {
    max: usize,
}

#[derive(Serialize)]
struct ReadArgs<'a> {
    uri: &'a str,
}

struct FieldMedia<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> FieldMedia<R> {
    fn capture_photo(&self) -> Result<Option<MediaPhoto>, String> {
        self.0
            .run_mobile_plugin::<CaptureResponse>("capturePhoto", ())
            .map(|response| response.photo)
            .map_err(|error| error.to_string())
    }

    fn pick_photos(&self, max: usize) -> Result<Vec<MediaPhoto>, String> {
        self.0
            .run_mobile_plugin::<PickResponse>("pickPhotos", PickArgs { max })
            .map(|response| response.photos)
            .map_err(|error| error.to_string())
    }

    fn read_photo(&self, uri: &str) -> Result<String, String> {
        self.0
            .run_mobile_plugin::<ReadResponse>("readPhoto", ReadArgs { uri })
            .map(|response| response.data_url)
            .map_err(|error| error.to_string())
    }
}

#[tauri::command]
async fn capture_photo<R: Runtime>(app: AppHandle<R>) -> Result<Option<MediaPhoto>, String> {
    app.state::<FieldMedia<R>>().capture_photo()
}

#[tauri::command]
async fn pick_photos<R: Runtime>(
    app: AppHandle<R>,
    max: usize,
) -> Result<Vec<MediaPhoto>, String> {
    app.state::<FieldMedia<R>>().pick_photos(max)
}

#[tauri::command]
async fn read_photo<R: Runtime>(app: AppHandle<R>, uri: String) -> Result<String, String> {
    app.state::<FieldMedia<R>>().read_photo(&uri)
}

fn init_mobile<R: Runtime, C: serde::de::DeserializeOwned>(
    app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> tauri::Result<FieldMedia<R>> {
    let handle = api.register_android_plugin("org.geolibre.fieldmedia", "FieldMediaPlugin")?;
    let _ = app;
    Ok(FieldMedia(handle))
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("field-media")
        .invoke_handler(tauri::generate_handler![capture_photo, pick_photos, read_photo])
        .setup(|app, api| {
            app.manage(init_mobile(app, api)?);
            Ok(())
        })
        .build()
}
