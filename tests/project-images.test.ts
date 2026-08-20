import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  externalizeNativeProjectImages,
  externalizeProjectImages,
  hydrateProjectImages,
} from "../apps/geolibre-desktop/src/lib/project-images";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("project images", () => {
  it("extracts inline photos and hydrates them back", async () => {
    const content = JSON.stringify({
      layers: [{ data: { features: [{ properties: { geolibre_photo: PNG } }] } }],
    });
    const packed = externalizeProjectImages(content);
    assert.equal(packed.files.length, 1);
    assert.equal(packed.imageReferences, 1);
    assert.equal(packed.nativeReferences, 0);
    assert.match(packed.files[0].path, /^images\/[0-9a-f]{8}\.png$/);
    assert.equal(
      JSON.parse(packed.content).layers[0].data.features[0].properties.geolibre_photo,
      packed.files[0].path,
    );
    const files = Object.fromEntries(packed.files.map((file) => [file.path, file.bytes]));
    const hydrated = await hydrateProjectImages(packed.content, async (path) => files[path] ?? null);
    assert.equal(
      JSON.parse(hydrated).layers[0].data.features[0].properties.geolibre_photo,
      PNG,
    );
  });

  it("resolves Android photo URIs into portable image files", async () => {
    const packed = await externalizeNativeProjectImages(
      JSON.stringify({ photo: "content://field/photo-1" }),
      async (source) => {
        assert.equal(source, "content://field/photo-1");
        return PNG;
      },
    );
    assert.equal(packed.files.length, 1);
    assert.equal(packed.imageReferences, 1);
    assert.equal(packed.nativeReferences, 1);
    assert.match(JSON.parse(packed.content).photo, /^images\/[0-9a-f]{8}\.png$/);
  });

  it("reuses one file for duplicate photos and leaves svg inline", () => {
    const svg = "data:image/svg+xml;base64,PHN2Zy8+";
    const packed = externalizeProjectImages(
      JSON.stringify({ a: PNG, b: PNG, icon: svg }),
    );
    assert.equal(packed.files.length, 1);
    const parsed = JSON.parse(packed.content) as { a: string; b: string; icon: string };
    assert.equal(parsed.a, parsed.b);
    assert.equal(parsed.icon, svg);
  });
});
