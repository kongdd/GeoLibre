import { setPhotoSourceResolver } from "@geolibre/core";
import { remoteProjectFileUrl } from "@geolibre/processing";
import { invoke } from "@tauri-apps/api/core";
import { isAndroid } from "./is-mobile";
import { isTauri } from "./is-tauri";
import type { RemotePhotoQuality } from "./file-names";

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

export function openNativePhoto(uri: string): Promise<void> {
  return invoke("plugin:field-media|open_photo", { uri });
}

const photoCache = new Map<string, Promise<string>>();

export function readNativePhoto(
  uri: string,
  quality: RemotePhotoQuality = "original",
): Promise<string> {
  if (!nativeFieldMediaAvailable()) return Promise.resolve("");
  const key = `${quality}:${uri}`;
  let pending = photoCache.get(key);
  if (!pending) {
    pending = invoke<string>("plugin:field-media|read_photo", { uri, quality })
      .catch((error) => {
        console.error("Could not read Field Survey photo", error);
        return "";
      })
      .finally(() => photoCache.delete(key));
    photoCache.set(key, pending);
  }
  return pending;
}

let remoteProjectPrefix: string | null = null;

export function setRemoteProjectPhotoPrefix(prefix: string | null): void {
  remoteProjectPrefix = prefix;
}

setPhotoSourceResolver((source, original) => {
  if (source.startsWith("content://")) {
    return readNativePhoto(source, original ? "original" : "optimized");
  }
  if (remoteProjectPrefix && source.startsWith("images/")) {
    return Promise.resolve(
      remoteProjectFileUrl(`${remoteProjectPrefix}/${source}`, !original),
    );
  }
  return Promise.resolve(source);
});
