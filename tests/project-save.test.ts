import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let originalWindow: typeof globalThis.window | undefined;
let originalSelf: PropertyDescriptor | undefined;
let openRecentProjectFile: typeof import("../apps/geolibre-desktop/src/lib/tauri-io").openRecentProjectFile;
let saveProjectFile: typeof import("../apps/geolibre-desktop/src/lib/tauri-io").saveProjectFile;
let saveRemoteProjectFile: typeof import("../apps/geolibre-desktop/src/lib/tauri-io").saveRemoteProjectFile;

describe("project save", () => {
  before(async () => {
    originalWindow = globalThis.window;
    originalSelf = Object.getOwnPropertyDescriptor(globalThis, "self");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          hostname: "localhost",
          origin: "http://localhost",
          port: "",
          protocol: "http:",
        },
      },
    });
    (globalThis as { self?: unknown }).self ??= globalThis;
    ({ openRecentProjectFile, saveProjectFile, saveRemoteProjectFile } = await import(
      "../apps/geolibre-desktop/src/lib/tauri-io"
    ));
  });

  after(() => {
    if (originalWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    if (originalSelf === undefined) Reflect.deleteProperty(globalThis, "self");
    else Object.defineProperty(globalThis, "self", originalSelf);
  });

  it("saves a local project unchanged through the browser picker", async () => {
    const content = JSON.stringify({ image: PNG });
    let written: unknown;
    (globalThis.window as unknown as Record<string, unknown>).showSaveFilePicker = async () => ({
      name: "local.geolibre.json",
      createWritable: async () => ({
        write: async (value: unknown) => {
          written = value;
        },
        close: async () => undefined,
      }),
    });

    assert.equal(await saveProjectFile(content, "local.geolibre.json"), "local.geolibre.json");
    assert.equal(written, content);
  });

  it("converts inline images to separate files for a remote project", async () => {
    const content = JSON.stringify({ image: PNG, data: { value: 42 } });
    const requests: { url: string; init?: RequestInit }[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      const name = new URL(url).searchParams.get("name");
      return new Response(JSON.stringify({ path: `/mnt/z/GeoLibre/${name}` }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      const path = "/mnt/z/GeoLibre/trip/trip.geolibre.json";
      const progress: { completedFiles: number; totalFiles: number; uploadedBytes: number; totalBytes: number }[] = [];
      assert.equal(await saveRemoteProjectFile(content, path, (value) => progress.push(value)), path);
      assert.deepEqual(
        progress.map(({ completedFiles, totalFiles }) => [completedFiles, totalFiles]),
        [[0, 2], [1, 2], [2, 2]],
      );
      assert.equal(progress.at(-1)?.uploadedBytes, progress.at(-1)?.totalBytes);
      assert.equal(progress.at(-1)?.projectBytes, progress.at(-1)?.totalBytes);
      assert.equal(progress.at(-1)?.reusedFiles, 0);
      assert.equal(progress.at(-1)?.retainedPhotoReferences, 1);
      assert.equal(requests.length, 2);

      const imageRequest = requests[0];
      assert.ok(imageRequest.init?.body instanceof Uint8Array);
      assert.equal(new Headers(imageRequest.init?.headers).get("Content-Type"), "application/octet-stream");

      const projectRequest = requests[1];
      assert.equal(projectRequest.init?.method, "POST");
      assert.equal(new URL(projectRequest.url).searchParams.get("name"), "trip/trip.geolibre.json");
      const saved = JSON.parse(String(projectRequest.init?.body)) as {
        image: string;
        data: { value: number };
      };
      assert.match(saved.image, /^images\/[0-9a-f]{8}\.png$/);
      assert.deepEqual(saved.data, { value: 42 });
      assert.equal(
        new URL(imageRequest.url).searchParams.get("name"),
        `trip/${saved.image}`,
      );

      const repeatedProgress: { completedFiles: number; totalFiles: number }[] = [];
      assert.equal(
        await saveRemoteProjectFile(content, path, ({ completedFiles, totalFiles }) =>
          repeatedProgress.push({ completedFiles, totalFiles }),
        ),
        path,
      );
      assert.deepEqual(repeatedProgress, [
        { completedFiles: 0, totalFiles: 1 },
        { completedFiles: 1, totalFiles: 1 },
      ]);
      assert.equal(progress.at(-1)?.projectFiles, 2);
      assert.equal(requests.length, 3);
      assert.equal(
        requests.filter(
          (request) => new URL(request.url).searchParams.get("name") === `trip/${saved.image}`,
        ).length,
        1,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("opens a remote project without eagerly downloading its photos", async () => {
    const originalFetch = globalThis.fetch;
    const content = JSON.stringify({
      version: "0.2.0",
      name: "trip",
      mapView: { center: [110, 32], zoom: 10, bearing: 0, pitch: 0 },
      layers: [],
      metadata: {},
      photo: "images/original.jpg",
    });
    let requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return new Response(content, { status: 200 });
    };

    try {
      const opened = await openRecentProjectFile(
        "/mnt/z/GeoLibre/trip/trip.geolibre.json",
      );
      assert.equal(requests, 1);
      assert.equal(JSON.parse(opened.text).photo, "images/original.jpg");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uploads full Android photo bytes and reports the real project size", async () => {
    const originalFetch = globalThis.fetch;
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const tauriWindow = globalThis.window as unknown as Record<string, unknown>;
    tauriWindow.__TAURI_INTERNALS__ = {};
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent: "Android" },
    });
    const original = new Uint8Array(3 * 1024 * 1024).fill(7);
    original.set([0xff, 0xd8, 0xff]);
    const dataUrl = `data:image/jpeg;base64,${Buffer.from(original).toString("base64")}`;
    const requests: RequestInit[] = [];
    globalThis.fetch = async (_input, init) => {
      requests.push(init ?? {});
      return new Response(
        JSON.stringify({ path: "/mnt/z/GeoLibre/originals/originals.geolibre.json" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    try {
      const progress: import("../apps/geolibre-desktop/src/lib/tauri-io").RemoteSaveProgress[] = [];
      const path = "/mnt/z/GeoLibre/originals/originals.geolibre.json";
      assert.equal(
        await saveRemoteProjectFile(
          JSON.stringify({ photo: "content://field/original" }),
          path,
          (value) => progress.push(value),
          "original",
          async (source, quality) => {
            assert.equal(source, "content://field/original");
            assert.equal(quality, "original");
            return dataUrl;
          },
        ),
        path,
      );
      assert.equal((requests[0].body as Uint8Array).length, original.length);
      assert.ok(progress.at(-1)!.projectBytes > original.length);
      assert.equal(progress.at(-1)?.retainedPhotoReferences, 0);
    } finally {
      globalThis.fetch = originalFetch;
      delete tauriWindow.__TAURI_INTERNALS__;
      if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
      else Reflect.deleteProperty(globalThis, "navigator");
    }
  });
});
