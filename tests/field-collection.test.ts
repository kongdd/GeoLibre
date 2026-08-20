import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_LAYER_STYLE } from "@geolibre/core";
import {
  appendFeature,
  buildGeometryFeature,
  buildProperties,
  buildSchema,
  collectionAttachmentKeys,
  collectionAttachments,
  collectionImagePropertyKeys,
  collectionMetadata,
  COLLECTION_ATTACHMENT_KEYS_KEY,
  COLLECTION_GEOMETRY_KEY,
  COLLECTION_SCHEMA_KEY,
  coerceValue,
  drawPreview,
  emptyFeatureCollection,
  featureVertices,
  fieldCollectionPointStats,
  findCollectionFeatureIndex,
  FIELD_COLLECTION_FLAG,
  getCollectionAttachmentKeys,
  getGeometryType,
  getSchema,
  importCollectionPoints,
  isCollectionLayer,
  makeLineFeature,
  makePointFeature,
  makePolygonFeature,
  MAX_NOTE_LENGTH,
  MAX_NOTES_PER_FEATURE,
  minVertices,
  NOTES_PROPERTY,
  OBSERVATION_NAME_PROPERTY,
  observationLabelStyle,
  parseOptions,
  PHOTO_BEARINGS_PROPERTY,
  PHOTO_NAMES_PROPERTY,
  PHOTO_PROPERTY,
  PHOTOS_PROPERTY,
  readCollectionAttachments,
  removeFeature,
  replaceFeature,
  slugifyKey,
  validateForm,
  withoutCollectionAttachments,
} from "../apps/geolibre-desktop/src/lib/field-collection";

describe("observationLabelStyle", () => {
  it("shows every observation name above its point", () => {
    const labels = observationLabelStyle(DEFAULT_LAYER_STYLE.labels);
    assert.equal(labels.enabled, true);
    assert.equal(labels.field, OBSERVATION_NAME_PROPERTY);
    assert.equal(labels.allowOverlap, true);
    assert.equal(labels.anchor, "bottom");
    assert.equal(labels.offsetY, -1.8);
  });
});

describe("slugifyKey", () => {
  it("slugifies labels to safe keys", () => {
    assert.equal(slugifyKey("Tree Species"), "tree_species");
    assert.equal(slugifyKey("  Height (m) "), "height_m");
    assert.equal(slugifyKey("123 Café!"), "123_caf");
  });

  it("falls back to 'field' for empty/symbol-only labels", () => {
    assert.equal(slugifyKey(""), "field");
    assert.equal(slugifyKey("!!!"), "field");
  });

  it("de-duplicates against taken keys", () => {
    assert.equal(slugifyKey("Name", ["name"]), "name_2");
    assert.equal(slugifyKey("Name", ["name", "name_2"]), "name_3");
  });
});

describe("buildSchema", () => {
  it("drops blank labels and assigns unique keys", () => {
    const schema = buildSchema([
      { label: "Name", type: "text" },
      { label: "", type: "text" },
      { label: "Name", type: "number" },
    ]);
    assert.deepEqual(
      schema.fields.map((f) => f.key),
      ["name", "name_2"]
    );
  });

  it("avoids the reserved photo key for a user 'Photo' field", () => {
    const schema = buildSchema([{ label: "Photo", type: "text" }]);
    // "Photo" would slug to "photo", which is reserved for the attached image.
    assert.notEqual(schema.fields[0].key, PHOTO_PROPERTY);
    assert.equal(schema.fields[0].key, "photo_2");
  });

  it("reserves the system observation name", () => {
    const schema = buildSchema([
      { label: "GeoLibre Observation Name", type: "text" },
    ]);
    assert.equal(OBSERVATION_NAME_PROPERTY, "geolibre_observation_name");
    assert.equal(schema.fields[0].key, "geolibre_observation_name_2");
  });

  it("reserves repeatable note and photo properties", () => {
    const schema = buildSchema([
      { label: "GeoLibre Notes", type: "text" },
      { label: "GeoLibre Photos", type: "text" },
    ]);
    assert.deepEqual(
      schema.fields.map((field) => field.key),
      ["geolibre_notes_2", "geolibre_photos_2"]
    );
  });

  it("keeps required and choice options only where relevant", () => {
    const schema = buildSchema([
      { label: "Status", type: "choice", required: true, options: ["a", "b"] },
      { label: "Note", type: "text", required: false },
    ]);
    assert.deepEqual(schema.fields[0], {
      key: "status",
      label: "Status",
      type: "choice",
      required: true,
      options: ["a", "b"],
    });
    // Non-required text field carries neither `required` nor `options`.
    assert.deepEqual(schema.fields[1], {
      key: "note",
      label: "Note",
      type: "text",
    });
  });
});

describe("parseOptions", () => {
  it("trims, drops blanks, and de-duplicates", () => {
    assert.deepEqual(parseOptions(" a, b ,a, ,c"), ["a", "b", "c"]);
    assert.deepEqual(parseOptions(""), []);
  });
});

describe("coerceValue", () => {
  it("returns null for blank input", () => {
    assert.equal(coerceValue("text", "  "), null);
    assert.equal(coerceValue("number", ""), null);
  });

  it("parses numbers and rejects non-numeric", () => {
    assert.equal(coerceValue("number", "42"), 42);
    assert.equal(coerceValue("number", "-3.5"), -3.5);
    assert.equal(coerceValue("number", "abc"), null);
  });

  it("keeps text/date/choice verbatim (trimmed)", () => {
    assert.equal(coerceValue("text", "  hi "), "hi");
    assert.equal(coerceValue("date", "2026-06-15"), "2026-06-15");
    assert.equal(coerceValue("choice", "b"), "b");
  });
});

describe("validateForm", () => {
  const schema = buildSchema([
    { label: "Name", type: "text", required: true },
    { label: "Count", type: "number" },
    { label: "Status", type: "choice", options: ["open", "closed"] },
  ]);

  it("passes a valid form", () => {
    const r = validateForm(schema, {
      name: "Oak",
      count: "3",
      status: "open",
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.errors, {});
  });

  it("flags missing required fields", () => {
    const r = validateForm(schema, { name: "  ", count: "3" });
    assert.equal(r.ok, false);
    assert.equal(r.errors.name, "required");
  });

  it("flags bad numbers and out-of-list choices", () => {
    const r = validateForm(schema, {
      name: "Oak",
      count: "not-a-number",
      status: "maybe",
    });
    assert.equal(r.errors.count, "number");
    assert.equal(r.errors.status, "choice");
  });

  it("allows an empty optional field", () => {
    const r = validateForm(schema, { name: "Oak" });
    assert.equal(r.ok, true);
  });
});

describe("buildProperties", () => {
  const schema = buildSchema([
    { label: "Name", type: "text" },
    { label: "Count", type: "number" },
  ]);

  it("coerces values and omits blanks, merging extras", () => {
    const props = buildProperties(
      schema,
      { name: "Oak", count: "5" },
      { [PHOTO_PROPERTY]: "data:image/png;base64,AAAA" }
    );
    assert.deepEqual(props, {
      name: "Oak",
      count: 5,
      photo: "data:image/png;base64,AAAA",
    });
  });

  it("omits fields left blank", () => {
    const props = buildProperties(schema, { name: "Oak", count: "" });
    assert.deepEqual(props, { name: "Oak" });
  });
});

describe("collectionAttachments", () => {
  it("keeps the primary photo compatible and stores additional photos", () => {
    assert.deepEqual(collectionAttachments(["one", "two", "three"], []), {
      [PHOTO_PROPERTY]: "one",
      [PHOTOS_PROPERTY]: ["two", "three"],
    });
  });

  it("stores content URIs, file names, and bearings without embedding images", () => {
    const uri = "content://media/external/images/media/42";
    const stored = collectionAttachments(
      [uri],
      [],
      [],
      undefined,
      [91.2],
      ["IMG_0042.jpg"]
    );
    assert.equal(stored[PHOTO_PROPERTY], uri);
    assert.deepEqual(stored[PHOTO_NAMES_PROPERTY], ["IMG_0042.jpg"]);
    assert.deepEqual(readCollectionAttachments(stored), {
      photos: [uri],
      photoNames: ["IMG_0042.jpg"],
      photoBearings: [91.2],
      notes: [],
    });
  });

  it("stores normalized photo bearings aligned with photos", () => {
    const stored = collectionAttachments(
      ["one", "two", "three"],
      [],
      [],
      undefined,
      [370.04, null, -10]
    );
    assert.deepEqual(stored[PHOTO_BEARINGS_PROPERTY], [10, null, 350]);
    assert.deepEqual(readCollectionAttachments(stored).photoBearings, [
      10,
      null,
      350,
    ]);
  });

  it("does not overwrite legacy schema fields that use attachment keys", () => {
    const properties = collectionAttachments(
      ["one", "two"],
      ["note"],
      [
        PHOTO_PROPERTY,
        PHOTOS_PROPERTY,
        NOTES_PROPERTY,
        "geolibre_photo_attachment",
      ]
    );
    assert.deepEqual(properties, {
      geolibre_photo_attachment_2: "one",
      geolibre_photo_attachments: ["two"],
      geolibre_note_entries: ["note"],
    });
  });

  it("preserves note text and omits blank attachments", () => {
    assert.match(NOTES_PROPERTY, /^geolibre_/);
    assert.deepEqual(collectionAttachments([], [" first ", "", "second"]), {
      [NOTES_PROPERTY]: [" first ", "second"],
    });
    assert.deepEqual(collectionAttachments([], ["  "]), {});
  });

  it("does not truncate oversized legacy attachments during an ordinary edit", () => {
    const notes = Array.from(
      { length: MAX_NOTES_PER_FEATURE + 1 },
      (_, index) =>
        index === 0 ? "x".repeat(MAX_NOTE_LENGTH + 1_000) : `note-${index}`
    );
    const photos = Array.from({ length: 11 }, (_, index) => `photo-${index}`);
    const keys = collectionAttachmentKeys();
    const stored = collectionAttachments(photos, notes, [], keys);
    const read = readCollectionAttachments(stored, [], keys);
    const rewritten = collectionAttachments(
      read.photos,
      read.notes,
      [],
      keys,
      read.photoBearings
    );
    assert.deepEqual(rewritten, stored);
    assert.equal(read.notes.length, 21);
    assert.equal(read.notes[0].length, 5_000);
    assert.equal(read.photos.length, 11);
  });

  it("round-trips collision-safe attachments for editing", () => {
    const occupied = [PHOTO_PROPERTY, NOTES_PROPERTY];
    const stored = {
      owner: "survey",
      ...collectionAttachments(["one", "two"], ["first", "second"], occupied),
    };
    assert.deepEqual(readCollectionAttachments(stored, occupied), {
      photos: ["one", "two"],
      photoBearings: [null, null],
      photoNames: ["", ""],
      notes: ["first", "second"],
    });
    assert.deepEqual(withoutCollectionAttachments(stored, occupied), {
      owner: "survey",
    });
    assert.deepEqual(collectionAttachmentKeys(occupied), {
      photo: "geolibre_photo_attachment",
      photos: PHOTOS_PROPERTY,
      photoBearings: PHOTO_BEARINGS_PROPERTY,
      photoNames: PHOTO_NAMES_PROPERTY,
      notes: "geolibre_note_entries",
    });
  });

  it("uses explicit metadata keys without deleting unrelated fallback properties", () => {
    const keys = {
      photo: "owned_photo",
      photos: "owned_photos",
      photoBearings: "owned_bearings",
      photoNames: "owned_names",
      notes: "owned_notes",
    };
    const properties = {
      geolibre_photo_attachment: "foreign",
      ...collectionAttachments(["one"], ["note"], [], keys),
    };
    assert.deepEqual(readCollectionAttachments(properties, [], keys), {
      photos: ["one"],
      photoBearings: [null],
      photoNames: [""],
      notes: ["note"],
    });
    assert.deepEqual(withoutCollectionAttachments(properties, [], keys), {
      geolibre_photo_attachment: "foreign",
    });
  });
});

describe("collection layer helpers", () => {
  it("summarizes sampling points and photos", () => {
    const metadata = collectionMetadata({ fields: [] });
    const keys = getCollectionAttachmentKeys({ type: "geojson", metadata });
    const layers = [
      {
        type: "geojson",
        metadata,
        geojson: {
          type: "FeatureCollection" as const,
          features: [
            makePointFeature(0, 0, collectionAttachments(["one", "two"], [], [], keys)),
            makePointFeature(1, 1, {}),
          ],
        },
      },
      {
        type: "geojson",
        metadata: {},
        geojson: {
          type: "FeatureCollection" as const,
          features: [makePointFeature(2, 2, { photo: "ignored" })],
        },
      },
    ];
    assert.deepEqual(fieldCollectionPointStats(layers), {
      points: 2,
      pointsWithPhotos: 1,
      photos: 2,
    });
  });

  it("round-trips the schema and geometry through metadata", () => {
    const schema = buildSchema([{ label: "Name", type: "text" }]);
    const meta = collectionMetadata(schema, "polygon", { existing: 1 });
    assert.equal(meta[FIELD_COLLECTION_FLAG], true);
    assert.equal(meta.existing, 1);
    assert.deepEqual(meta[COLLECTION_SCHEMA_KEY], schema);
    assert.equal(meta[COLLECTION_GEOMETRY_KEY], "polygon");
    assert.deepEqual(
      meta[COLLECTION_ATTACHMENT_KEYS_KEY],
      collectionAttachmentKeys(["name"])
    );

    const layer = { type: "geojson", metadata: meta };
    assert.equal(isCollectionLayer(layer), true);
    assert.deepEqual(getSchema(layer), schema);
    assert.equal(getGeometryType(layer), "polygon");
    assert.deepEqual(
      getCollectionAttachmentKeys(layer),
      collectionAttachmentKeys(["name"])
    );
  });

  it("defaults geometry to point when unset or invalid", () => {
    assert.equal(getGeometryType({ type: "geojson", metadata: {} }), "point");
    assert.equal(
      getGeometryType({
        type: "geojson",
        metadata: { collectionGeometry: "blob" },
      }),
      "point"
    );
  });

  it("does not treat ordinary layers as collection layers", () => {
    assert.equal(isCollectionLayer({ type: "geojson", metadata: {} }), false);
    assert.equal(
      isCollectionLayer({
        type: "raster",
        metadata: { fieldCollection: true },
      }),
      false
    );
  });

  it("does not claim or delete a preferred photo key containing ordinary text", () => {
    const layer = {
      type: "geojson",
      metadata: { [FIELD_COLLECTION_FLAG]: true },
      geojson: {
        type: "FeatureCollection" as const,
        features: [
          makePointFeature(0, 0, {
            photo: "portrait credit",
            [NOTES_PROPERTY]: ["external category"],
          }),
        ],
      },
    };
    const keys = getCollectionAttachmentKeys(layer);
    assert.notEqual(keys.photo, PHOTO_PROPERTY);
    assert.deepEqual(
      readCollectionAttachments(layer.geojson.features[0].properties, [], keys)
        .photos,
      []
    );
    assert.deepEqual(
      withoutCollectionAttachments(
        layer.geojson.features[0].properties,
        [],
        keys
      ),
      {
        photo: "portrait credit",
        [NOTES_PROPERTY]: ["external category"],
      }
    );
  });

  it("recognizes a strict legacy inline image without metadata", () => {
    const dataUrl = "data:image/png;base64,AAAA";
    const layer = {
      type: "geojson",
      metadata: { [FIELD_COLLECTION_FLAG]: true },
      geojson: {
        type: "FeatureCollection" as const,
        features: [makePointFeature(0, 0, { photo: dataUrl })],
      },
    };
    const keys = getCollectionAttachmentKeys(layer);
    assert.equal(keys.photo, PHOTO_PROPERTY);
    assert.deepEqual(
      readCollectionAttachments(layer.geojson.features[0].properties, [], keys)
        .photos,
      [dataUrl]
    );
    assert.deepEqual(
      withoutCollectionAttachments(
        layer.geojson.features[0].properties,
        [],
        keys
      ),
      {}
    );
  });

  it("migrates oversized and whitespace-preserving legacy notes with a strict image", () => {
    const dataUrl = "data:image/png;base64,AAAA";
    const legacyNotes = [
      ` ${"x".repeat(MAX_NOTE_LENGTH + 1)} `,
      ...Array.from(
        { length: MAX_NOTES_PER_FEATURE },
        (_, index) => `note-${index}`
      ),
    ];
    const layer = {
      type: "geojson",
      metadata: { [FIELD_COLLECTION_FLAG]: true },
      geojson: {
        type: "FeatureCollection" as const,
        features: [
          makePointFeature(0, 0, {
            [PHOTO_PROPERTY]: dataUrl,
            [NOTES_PROPERTY]: legacyNotes,
          }),
        ],
      },
    };

    const keys = getCollectionAttachmentKeys(layer);
    assert.equal(keys.photo, PHOTO_PROPERTY);
    assert.equal(keys.notes, NOTES_PROPERTY);
    assert.deepEqual(
      readCollectionAttachments(layer.geojson.features[0].properties, [], keys)
        .notes,
      legacyNotes
    );
  });

  it("trusts explicit collision-safe keys and preserves foreign fallback properties", () => {
    const explicit = {
      photo: "owned_photo",
      photos: "owned_photos",
      photoBearings: "owned_bearings",
      photoNames: "owned_names",
      notes: "owned_notes",
    };
    const layer = {
      type: "geojson",
      metadata: {
        [FIELD_COLLECTION_FLAG]: true,
        [COLLECTION_ATTACHMENT_KEYS_KEY]: explicit,
      },
      geojson: {
        type: "FeatureCollection" as const,
        features: [
          makePointFeature(0, 0, { geolibre_photo_attachment: "foreign" }),
        ],
      },
    };
    assert.deepEqual(getCollectionAttachmentKeys(layer), explicit);
    assert.deepEqual(
      withoutCollectionAttachments(
        layer.geojson.features[0].properties,
        [],
        explicit
      ),
      { geolibre_photo_attachment: "foreign" }
    );
  });

  it("builds dynamic image-column keys only from valid explicit metadata", () => {
    const explicit = {
      photo: "owned_photo",
      photos: "owned_photos",
      photoBearings: "owned_bearings",
      photoNames: "owned_names",
      notes: "owned_notes",
    };
    const dynamic = collectionImagePropertyKeys({
      [COLLECTION_ATTACHMENT_KEYS_KEY]: explicit,
    });
    assert.ok(dynamic.has(PHOTO_PROPERTY));
    assert.ok(dynamic.has("photo_full"));
    assert.ok(dynamic.has(PHOTOS_PROPERTY));
    assert.ok(dynamic.has("owned_photo"));
    assert.ok(dynamic.has("owned_photos"));
    assert.ok(dynamic.has("owned_names"));
    assert.ok(!dynamic.has("owned_notes"));
    assert.ok(!dynamic.has("owned_bearings"));
    assert.deepEqual(
      collectionImagePropertyKeys({
        [COLLECTION_ATTACHMENT_KEYS_KEY]: { photo: "ordinary" },
      }),
      collectionImagePropertyKeys(undefined)
    );
  });

  it("migrates legacy collision keys without claiming foreign fallback properties", () => {
    const schema = {
      fields: [
        {
          key: PHOTO_PROPERTY,
          label: "Legacy photo field",
          type: "text" as const,
        },
      ],
    };
    const layer = {
      type: "geojson",
      metadata: collectionMetadata(schema),
      geojson: {
        type: "FeatureCollection" as const,
        features: [
          makePointFeature(0, 0, { geolibre_photo_attachment: "foreign" }),
        ],
      },
    };
    delete layer.metadata[COLLECTION_ATTACHMENT_KEYS_KEY];
    assert.equal(
      getCollectionAttachmentKeys(layer).photo,
      "geolibre_photo_attachment_2"
    );
  });

  it("getSchema defaults to empty for a malformed schema", () => {
    assert.deepEqual(
      getSchema({ type: "geojson", metadata: { collectionSchema: 42 } }),
      {
        fields: [],
      }
    );
  });
});

describe("importCollectionPoints", () => {
  it("normalizes CSV/Shapefile point IDs and names", () => {
    const imported = importCollectionPoints({
      type: "FeatureCollection",
      features: [
        makePointFeature(110.1, 32.6, { ID: "site-1", NAME: "河口" }),
        makePointFeature(110.2, 32.7, { id: "site-1", name: "坝址" }),
        makeLineFeature(
          [
            [110, 32],
            [111, 33],
          ],
          { id: "line" }
        ),
      ],
    });

    assert.equal(imported.skipped, 1);
    assert.deepEqual(
      imported.data.features.map((feature) => feature.id),
      ["site-1", "site-1_2"]
    );
    assert.deepEqual(imported.data.features[0].properties, {
      id: "site-1",
      name: "河口",
      [OBSERVATION_NAME_PROPERTY]: "河口",
    });
  });
});

describe("feature builders", () => {
  it("makes a point feature with the given coordinate and props", () => {
    const f = makePointFeature(-83.5, 35.6, { name: "Oak" });
    assert.deepEqual(f.geometry, { type: "Point", coordinates: [-83.5, 35.6] });
    assert.deepEqual(f.properties, { name: "Oak" });
  });

  it("reads editable vertices and replaces a saved feature immutably", () => {
    const point = makePointFeature(10, 20, { name: "old" });
    const line = makeLineFeature(
      [
        [1, 2],
        [3, 4],
      ],
      {}
    );
    const polygon = makePolygonFeature(
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
      {}
    );
    assert.deepEqual(featureVertices(point, "point"), [[10, 20]]);
    assert.deepEqual(featureVertices(line, "line"), [
      [1, 2],
      [3, 4],
    ]);
    assert.deepEqual(featureVertices(polygon, "polygon"), [
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
    assert.equal(featureVertices(point, "line"), null);

    const fc = { type: "FeatureCollection" as const, features: [point] };
    const updated = replaceFeature(
      fc,
      0,
      makePointFeature(30, 40, { name: "new" })
    );
    assert.equal(fc.features[0].properties?.name, "old");
    assert.equal(updated.features[0].properties?.name, "new");
    assert.equal(replaceFeature(fc, 4, point), fc);

    const pair = { ...fc, features: [point, updated.features[0]] };
    const removed = removeFeature(pair, 0);
    assert.equal(pair.features.length, 2);
    assert.equal(removed.features.length, 1);
    assert.equal(removed.features[0].properties?.name, "new");
    assert.equal(removeFeature(pair, 4), pair);
  });

  it("finds an observation by id, with a legacy index fallback", () => {
    const features = [
      { ...makePointFeature(0, 0, {}), id: "survey-a" },
      makePointFeature(1, 1, {}),
    ];
    assert.equal(findCollectionFeatureIndex(features, "survey-a"), 0);
    assert.equal(findCollectionFeatureIndex(features, "1"), 1);
    assert.equal(findCollectionFeatureIndex(features, "missing"), -1);
  });

  it("appends immutably", () => {
    const fc = emptyFeatureCollection();
    const next = appendFeature(fc, makePointFeature(0, 0, {}));
    assert.equal(fc.features.length, 0);
    assert.equal(next.features.length, 1);
  });
});

describe("line/polygon geometry", () => {
  it("minVertices is 1/2/3 for point/line/polygon", () => {
    assert.equal(minVertices("point"), 1);
    assert.equal(minVertices("line"), 2);
    assert.equal(minVertices("polygon"), 3);
  });

  it("makeLineFeature keeps the vertex order", () => {
    const f = makeLineFeature(
      [
        [0, 0],
        [1, 1],
        [2, 0],
      ],
      { name: "Trail" }
    );
    assert.equal(f.geometry.type, "LineString");
    assert.deepEqual(f.geometry.coordinates, [
      [0, 0],
      [1, 1],
      [2, 0],
    ]);
  });

  it("makePolygonFeature closes an open ring", () => {
    const f = makePolygonFeature(
      [
        [0, 0],
        [2, 0],
        [2, 2],
      ],
      {}
    );
    assert.equal(f.geometry.type, "Polygon");
    const ring = f.geometry.coordinates[0];
    assert.deepEqual(ring[0], ring[ring.length - 1]); // closed
    assert.equal(ring.length, 4);
  });

  it("makePolygonFeature does not double-close an already-closed ring", () => {
    const ring = [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 0],
    ] as [number, number][];
    const f = makePolygonFeature(ring, {});
    assert.equal(f.geometry.coordinates[0].length, 4);
  });

  it("buildGeometryFeature throws on empty point coords", () => {
    assert.throws(() => buildGeometryFeature("point", [], {}));
  });

  it("buildGeometryFeature dispatches on geometry type", () => {
    assert.equal(
      buildGeometryFeature("point", [[1, 2]], {}).geometry.type,
      "Point"
    );
    assert.equal(
      buildGeometryFeature(
        "line",
        [
          [0, 0],
          [1, 1],
        ],
        {}
      ).geometry.type,
      "LineString"
    );
    assert.equal(
      buildGeometryFeature(
        "polygon",
        [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
        {}
      ).geometry.type,
      "Polygon"
    );
  });

  it("drawPreview includes a vertex point per coord and a line at >= 2", () => {
    const one = drawPreview("line", [[0, 0]]);
    assert.equal(one.features.length, 1); // just the vertex
    const two = drawPreview("line", [
      [0, 0],
      [1, 1],
    ]);
    // two vertices + one line
    assert.equal(two.features.length, 3);
    assert.ok(two.features.some((f) => f.geometry?.type === "LineString"));
  });

  it("drawPreview closes the polygon fill at >= 3 vertices", () => {
    const two = drawPreview("polygon", [
      [0, 0],
      [1, 0],
    ]);
    // 2 vertices + ring line, no fill yet
    assert.ok(!two.features.some((f) => f.geometry?.type === "Polygon"));
    const three = drawPreview("polygon", [
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
    // 3 vertices + line + polygon fill
    assert.equal(three.features.length, 5);
    assert.ok(three.features.some((f) => f.geometry?.type === "Polygon"));
  });
});
