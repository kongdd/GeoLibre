import { setPhotoSourceResolver } from "@geolibre/core";
import { readProjectFromRemote } from "@geolibre/processing";
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
        if (quality === "optimized") {
          console.warn("Could not create Field Survey thumbnail; loading original", error);
          return invoke<string>("plugin:field-media|read_photo", {
            uri,
            quality: "original",
          });
        }
        throw error;
      })
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
const remotePhotoCache = new Map<string, Promise<string>>();

export function setRemoteProjectPhotoPrefix(prefix: string | null): void {
  if (prefix === remoteProjectPrefix) return;
  for (const pending of remotePhotoCache.values()) {
    void pending.then((url) => URL.revokeObjectURL(url));
  }
  remotePhotoCache.clear();
  remoteProjectPrefix = prefix;
}

function readRemotePhoto(source: string, original: boolean): Promise<string> {
  const path = `${remoteProjectPrefix}/${source}`;
  const key = `${original}:${path}`;
  let pending = remotePhotoCache.get(key);
  if (!pending) {
    pending = readProjectFromRemote(path, { thumbnail: !original })
      .then((bytes) => URL.createObjectURL(new Blob([bytes])))
      .catch((error) => {
        remotePhotoCache.delete(key);
        console.error("Could not read remote Field Survey photo", error);
        return "";
      });
    remotePhotoCache.set(key, pending);
  }
  return pending;
}

setPhotoSourceResolver((source, original) => {
  if (source.startsWith("content://")) {
    return readNativePhoto(source, original ? "original" : "optimized");
  }
  if (remoteProjectPrefix && source.startsWith("images/")) {
    return readRemotePhoto(source, original);
  }
  return Promise.resolve(source);
});
