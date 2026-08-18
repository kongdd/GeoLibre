import { invoke } from "@tauri-apps/api/core";
import { setPhotoSourceResolver } from "@geolibre/core";
import { isAndroid } from "./is-mobile";
import { isTauri } from "./is-tauri";

export interface NativePhoto {
  uri: string;
  name: string;
  mimeType: string;
  bearing: number | null;
}

export function nativeFieldMediaAvailable(): boolean {
  return isTauri() && isAndroid();
}

export function captureNativePhoto(): Promise<NativePhoto | null> {
  return invoke("plugin:field-media|capture_photo");
}

export function pickNativePhotos(max: number): Promise<NativePhoto[]> {
  return invoke("plugin:field-media|pick_photos", { max });
}

const photoCache = new Map<string, Promise<string>>();

export function readNativePhoto(uri: string): Promise<string> {
  if (!nativeFieldMediaAvailable()) return Promise.resolve("");
  let pending = photoCache.get(uri);
  if (!pending) {
    pending = invoke<string>("plugin:field-media|read_photo", { uri })
      .catch((error) => {
        console.error("Could not read Field Survey photo", error);
        return "";
      })
      .finally(() => photoCache.delete(uri));
    photoCache.set(uri, pending);
  }
  return pending;
}

setPhotoSourceResolver(readNativePhoto);
