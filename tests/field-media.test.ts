import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { resolvePhotoSource } from "@geolibre/core";
import { setSidecarAuthToken } from "@geolibre/processing";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  readNativePhoto,
  setRemoteProjectPhotoPrefix,
} from "../apps/geolibre-desktop/src/lib/field-media";

const originalFetch = globalThis.fetch;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

afterEach(() => {
  globalThis.fetch = originalFetch;
  setRemoteProjectPhotoPrefix(null);
  setSidecarAuthToken(null);
  if (typeof window !== "undefined") clearMocks();
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else Reflect.deleteProperty(globalThis, "navigator");
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

describe("Field Survey photos", () => {
  it("falls back to the Android original when thumbnail decoding fails", async () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent: "Android" },
    });
    const qualities: unknown[] = [];
    mockIPC((_command, args) => {
      const quality = (args as { quality?: unknown }).quality;
      qualities.push(quality);
      if (quality === "optimized") throw new Error("thumbnail failed");
      return "data:image/jpeg;base64,AA==";
    });

    const source = await readNativePhoto("content://media/photo/1", "optimized");

    assert.equal(source, "data:image/jpeg;base64,AA==");
    assert.deepEqual(qualities, ["optimized", "original"]);
  });

  it("loads thumbnails through the authenticated sidecar client", async () => {
    let requestUrl = "";
    let token = "";
    setSidecarAuthToken("secret");
    setRemoteProjectPhotoPrefix("survey");
    globalThis.fetch = async (input, init) => {
      requestUrl = String(input);
      token = new Headers(init?.headers).get("X-GeoLibre-Token") ?? "";
      return new Response(new Uint8Array([1, 2, 3]));
    };

    const source = await resolvePhotoSource("images/photo.jpg");

    assert.match(source, /^blob:/);
    assert.match(requestUrl, /name=survey%2Fimages%2Fphoto\.jpg/);
    assert.match(requestUrl, /thumbnail=1/);
    assert.equal(token, "secret");
  });
});
