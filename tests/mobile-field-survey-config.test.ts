import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const IOS_INFO = readFileSync(
  new URL("../apps/geolibre-desktop/src-tauri/Info.ios.plist", import.meta.url),
  "utf8"
);
const FIELD_DIALOG = readFileSync(
  new URL(
    "../apps/geolibre-desktop/src/components/layout/FieldCollectionDialog.tsx",
    import.meta.url
  ),
  "utf8"
);
const FIELD_MEDIA = readFileSync(
  new URL(
    "../apps/geolibre-desktop/src-tauri/vendor/tauri-plugin-field-media/android/src/main/java/FieldMediaPlugin.kt",
    import.meta.url
  ),
  "utf8"
);
const MAP_CANVAS = readFileSync(
  new URL("../packages/map/src/MapCanvas.tsx", import.meta.url),
  "utf8"
);
const INDEX_CSS = readFileSync(
  new URL("../apps/geolibre-desktop/src/index.css", import.meta.url),
  "utf8"
);
const TOOLBAR_CONSTANTS = readFileSync(
  new URL(
    "../apps/geolibre-desktop/src/components/layout/toolbar/constants.ts",
    import.meta.url
  ),
  "utf8"
);

describe("Field Survey mobile permissions", () => {
  it("declares every protected iOS API used by GPS and photo capture", () => {
    for (const key of [
      "NSLocationWhenInUseUsageDescription",
      "NSCameraUsageDescription",
      "NSPhotoLibraryUsageDescription",
      "NSMotionUsageDescription",
    ]) {
      assert.match(
        IOS_INFO,
        new RegExp(`<key>${key}</key>\\s*<string>[^<]+</string>`)
      );
    }
  });

  it("stores Android originals in Pictures/GeoLibre without a delete command", () => {
    assert.match(FIELD_MEDIA, /MediaStore\.ACTION_IMAGE_CAPTURE/);
    assert.match(FIELD_MEDIA, /DIRECTORY_PICTURES}\/GeoLibre/);
    assert.match(FIELD_MEDIA, /loadThumbnail/);
    assert.doesNotMatch(FIELD_MEDIA, /fun deletePhoto/);
  });

  it("opens the exact observation carried by the map click", () => {
    assert.match(MAP_CANVAS, /new CustomEvent\(OPEN_FIELD_COLLECTION_EVENT/);
    assert.match(MAP_CANVAS, /detail: \{ layerId, featureId \}/);
    const clickEditor = FIELD_DIALOG.slice(
      FIELD_DIALOG.indexOf("// The map click carries its exact layer/feature target"),
      FIELD_DIALOG.indexOf("const handleCancelEdit")
    );
    assert.match(clickEditor, /openFeature\.featureId/);
    assert.doesNotMatch(clickEditor, /selectFeature\(null\)/);
  });

  it("keeps legacy id repair draft-only until Update is committed", () => {
    const editHandler = FIELD_DIALOG.slice(
      FIELD_DIALOG.indexOf("const handleEditFeature"),
      FIELD_DIALOG.indexOf("const handleCancelEdit")
    );
    assert.match(editHandler, /setEditingFeatureIndex\(index\)/);
    assert.doesNotMatch(editHandler, /updateLayer\(/);
  });

  it("passes the translated close label to both Field Survey dialogs", () => {
    assert.equal(
      FIELD_DIALOG.match(/closeLabel=\{t\("common\.close"\)\}/g)?.length,
      2
    );
  });

  it("clears the dialog translation in the mobile full-screen layout", () => {
    const rule = INDEX_CSS.slice(
      INDEX_CSS.indexOf(".field-collection-dialog {"),
      INDEX_CSS.indexOf(".field-collection-header {")
    );
    assert.match(rule, /--tw-translate-x: 0px !important/);
    assert.match(rule, /--tw-translate-y: 0px !important/);
  });

  it("keeps the location control visible after creating a project", () => {
    const controls = TOOLBAR_CONSTANTS.slice(
      TOOLBAR_CONSTANTS.indexOf("NEW_PROJECT_VISIBLE_BUILT_IN_CONTROLS"),
      TOOLBAR_CONSTANTS.indexOf("]);", TOOLBAR_CONSTANTS.indexOf("NEW_PROJECT_VISIBLE"))
    );
    assert.match(controls, /"geolocate"/);
  });
});
