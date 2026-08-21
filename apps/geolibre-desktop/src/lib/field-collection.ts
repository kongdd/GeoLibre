/**
 * Pure helpers for the Field Collection tool: defining a per-layer form schema,
 * validating captured attribute values, and building GeoJSON point features.
 *
 * Everything here is side-effect free so it can be unit tested without a DOM or
 * the app store. The React dialog (FieldCollectionDialog.tsx) owns the GPS,
 * map-click, and store wiring and delegates the data shaping to these functions.
 *
 * A "collection layer" is an ordinary `geojson` GeoLibreLayer tagged with
 * `metadata.fieldCollection === true` and carrying its schema under
 * `metadata.collectionSchema`. Both ride through `.geolibre.json` save/load via
 * the layer's free-form `metadata` bag, so collection layers reopen ready to use.
 */
import {
  coerceAttributeFormValue,
  FIELD_COLLECTION_ATTACHMENT_KEYS_METADATA,
  fieldCollectionAttachmentKeysFromMetadata,
  getAttributeFormField,
  PHOTO_BEARINGS_PROPERTY,
  PHOTO_FULL_PROPERTY,
  PHOTO_NAMES_PROPERTY,
  PHOTO_PROPERTY,
  PHOTOS_PROPERTY,
  type AttributeFormConfig,
  type FieldCollectionAttachmentKeys,
  type LabelStyle,
} from "@geolibre/core";
import type {
  Feature,
  FeatureCollection,
  LineString,
  Point,
  Polygon,
} from "geojson";
import { normalizePhotoBearing } from "./photo-bearing";

// Re-exported so existing importers (geotagged-photos, tests) keep a single
// import site; the canonical definitions live in @geolibre/core's schema.
export {
  PHOTO_BEARINGS_PROPERTY,
  PHOTO_FULL_PROPERTY,
  PHOTO_NAMES_PROPERTY,
  PHOTO_PROPERTY,
  PHOTOS_PROPERTY,
};

/** The attribute field kinds a collection form can declare. */
export type FieldType = "text" | "number" | "date" | "choice";

/** Geometry a collection layer captures. A layer holds one geometry type. */
export type GeometryType = "point" | "line" | "polygon";

/** A captured coordinate as [lng, lat]. */
export type Vertex = [number, number];

export interface CollectionField {
  /** Stable, slugified property key written to every captured feature. */
  key: string;
  /** Human-readable label shown in the capture form. */
  label: string;
  type: FieldType;
  required?: boolean;
  /** Allowed values for `choice` fields. */
  options?: string[];
}

export interface CollectionSchema {
  fields: CollectionField[];
}

/** `metadata` keys used to tag a collection layer and store its schema. */
export const FIELD_COLLECTION_FLAG = "fieldCollection";
export const COLLECTION_SCHEMA_KEY = "collectionSchema";
export const COLLECTION_GEOMETRY_KEY = "collectionGeometry";
export const COLLECTION_ATTACHMENT_KEYS_KEY =
  FIELD_COLLECTION_ATTACHMENT_KEYS_METADATA;

/** Namespaced properties managed by Field Collection for one observation. */
export const OBSERVATION_NAME_PROPERTY = "geolibre_observation_name";

/** Default map label for every saved point observation. */
export function observationLabelStyle(labels: LabelStyle): LabelStyle {
  return {
    ...labels,
    enabled: true,
    field: OBSERVATION_NAME_PROPERTY,
    allowOverlap: false,
    anchor: "bottom",
    offsetY: -1.8,
  };
}

export const NOTES_PROPERTY = "geolibre_notes";
const PHOTO_FALLBACK_PROPERTY = "geolibre_photo_attachment";
const PHOTOS_FALLBACK_PROPERTY = "geolibre_photo_attachments";
const PHOTO_BEARINGS_FALLBACK_PROPERTY = "geolibre_photo_directions";
const PHOTO_NAMES_FALLBACK_PROPERTY = "geolibre_photo_file_names";
const NOTES_FALLBACK_PROPERTY = "geolibre_note_entries";

/** Inline-image keys hidden from ordinary attribute-table columns. */
export const RESERVED_IMAGE_PROPERTY_KEYS: readonly string[] = [
  PHOTO_PROPERTY,
  PHOTO_FULL_PROPERTY,
  PHOTOS_PROPERTY,
];

/** All system-managed keys; custom form fields must not reuse them. */
export const RESERVED_PROPERTY_KEYS: readonly string[] = [
  ...RESERVED_IMAGE_PROPERTY_KEYS,
  OBSERVATION_NAME_PROPERTY,
  NOTES_PROPERTY,
  PHOTO_BEARINGS_PROPERTY,
  PHOTO_NAMES_PROPERTY,
  PHOTO_FALLBACK_PROPERTY,
  PHOTOS_FALLBACK_PROPERTY,
  PHOTO_BEARINGS_FALLBACK_PROPERTY,
  PHOTO_NAMES_FALLBACK_PROPERTY,
  NOTES_FALLBACK_PROPERTY,
];

/** Hard limits keep inline attachments from growing project JSON without bound. */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS_PER_FEATURE = 10;
export const MAX_NOTES_PER_FEATURE = 20;
export const MAX_NOTE_LENGTH = 4_000;

const INLINE_IMAGE_DATA_URL =
  /^data:image\/(?!svg\+xml(?:;|,))[-+.\w]+;base64,[a-z\d+/]+={0,2}$/i;

export type CollectionAttachmentKeys = FieldCollectionAttachmentKeys;

function isInlineImage(value: unknown): value is string {
  return typeof value === "string" && INLINE_IMAGE_DATA_URL.test(value);
}

/** Image columns hidden by the attribute table for one layer. */
export function collectionImagePropertyKeys(
  metadata: Record<string, unknown> | null | undefined
): Set<string> {
  const keys = new Set<string>(RESERVED_IMAGE_PROPERTY_KEYS);
  const explicit = fieldCollectionAttachmentKeysFromMetadata(metadata);
  if (explicit) {
    keys.add(explicit.photo);
    keys.add(explicit.photos);
    keys.add(explicit.photoNames);
  }
  return keys;
}

/** Resolve collision-free attachment keys deterministically for one schema. */
export function collectionAttachmentKeys(
  occupiedKeys: Iterable<string> = [],
  unavailableFallbackKeys: Iterable<string> = []
): CollectionAttachmentKeys {
  const taken = new Set(occupiedKeys);
  const unavailableFallbacks = new Set(unavailableFallbackKeys);
  const availableKey = (preferred: string, fallback: string): string => {
    if (!taken.has(preferred)) {
      taken.add(preferred);
      return preferred;
    }
    let key = fallback;
    let suffix = 2;
    while (taken.has(key) || unavailableFallbacks.has(key))
      key = `${fallback}_${suffix++}`;
    taken.add(key);
    return key;
  };
  return {
    photo: availableKey(PHOTO_PROPERTY, PHOTO_FALLBACK_PROPERTY),
    photos: availableKey(PHOTOS_PROPERTY, PHOTOS_FALLBACK_PROPERTY),
    photoBearings: availableKey(
      PHOTO_BEARINGS_PROPERTY,
      PHOTO_BEARINGS_FALLBACK_PROPERTY
    ),
    photoNames: availableKey(
      PHOTO_NAMES_PROPERTY,
      PHOTO_NAMES_FALLBACK_PROPERTY
    ),
    notes: availableKey(NOTES_PROPERTY, NOTES_FALLBACK_PROPERTY),
  };
}

/** Build backward-compatible feature properties for repeatable notes and photos. */
export function collectionAttachments(
  photos: readonly string[],
  notes: readonly string[],
  occupiedKeys: Iterable<string> = [],
  attachmentKeys?: CollectionAttachmentKeys,
  photoBearings: readonly (number | null)[] = [],
  photoNames: readonly string[] = []
): Record<string, unknown> {
  const cleanPhotos = photos
    .map((photo, index) => ({
      photo,
      bearing: normalizePhotoBearing(photoBearings[index]),
      name: photoNames[index]?.trim() ?? "",
    }))
    .filter(({ photo }) => Boolean(photo));
  // Admission limits are enforced by the capture UI. Serialization deliberately
  // keeps every existing value byte-for-byte so editing an ordinary field can
  // never truncate imported or legacy attachments that exceed today's limits.
  const cleanNotes = notes.filter((note) => note.trim().length > 0);
  const keys = attachmentKeys ?? collectionAttachmentKeys(occupiedKeys);
  const properties: Record<string, unknown> = {};
  if (cleanPhotos.length > 0) properties[keys.photo] = cleanPhotos[0].photo;
  if (cleanPhotos.length > 1) {
    properties[keys.photos] = cleanPhotos.slice(1).map(({ photo }) => photo);
  }
  const bearings = cleanPhotos.map(({ bearing }) => bearing);
  if (bearings.some((bearing) => bearing != null))
    properties[keys.photoBearings] = bearings;
  const names = cleanPhotos.map(({ name }) => name);
  if (names.some(Boolean)) properties[keys.photoNames] = names;
  if (cleanNotes.length > 0) properties[keys.notes] = cleanNotes;
  return properties;
}

/** Read editable attachments from a captured feature. */
export function readCollectionAttachments(
  properties: Record<string, unknown> | null | undefined,
  occupiedKeys: Iterable<string> = [],
  attachmentKeys?: CollectionAttachmentKeys
): {
  photos: string[];
  photoBearings: (number | null)[];
  photoNames: string[];
  notes: string[];
} {
  const keys = attachmentKeys ?? collectionAttachmentKeys(occupiedKeys);
  const props = properties ?? {};
  const photos: string[] = [];
  const primaryPhoto = props[keys.photo];
  if (typeof primaryPhoto === "string" && primaryPhoto)
    photos.push(primaryPhoto);
  const additionalPhotos = props[keys.photos];
  if (Array.isArray(additionalPhotos)) {
    photos.push(
      ...additionalPhotos.filter(
        (value): value is string => typeof value === "string"
      )
    );
  }
  const rawBearings = props[keys.photoBearings];
  const photoBearings = photos.map((_, index) =>
    normalizePhotoBearing(
      Array.isArray(rawBearings) ? rawBearings[index] : null
    )
  );
  const rawNames = props[keys.photoNames];
  const photoNames = photos.map((_, index) =>
    Array.isArray(rawNames) && typeof rawNames[index] === "string"
      ? rawNames[index]
      : ""
  );
  const rawNotes = props[keys.notes];
  const notes = Array.isArray(rawNotes)
    ? rawNotes.filter((value): value is string => typeof value === "string")
    : typeof rawNotes === "string" && rawNotes
    ? [rawNotes]
    : [];
  return { photos, photoBearings, photoNames, notes };
}

/** Remove only system attachment properties, preserving schema and foreign data. */
export function withoutCollectionAttachments(
  properties: Record<string, unknown> | null | undefined,
  occupiedKeys: Iterable<string> = [],
  attachmentKeys?: CollectionAttachmentKeys
): Record<string, unknown> {
  const copy = { ...(properties ?? {}) };
  const keys = attachmentKeys ?? collectionAttachmentKeys(occupiedKeys);
  delete copy[keys.photo];
  delete copy[keys.photos];
  delete copy[keys.photoBearings];
  delete copy[keys.photoNames];
  delete copy[keys.notes];
  return copy;
}

/** Minimal structural view of a layer — avoids coupling this module to the store. */
export interface CollectionLayerLike {
  type: string;
  metadata?: Record<string, unknown> | null;
  geojson?: FeatureCollection;
}

export function emptyFeatureCollection(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

export interface ImportedCollectionPhoto {
  path: string;
  name: string;
}

export interface ImportedCollectionPoints {
  data: FeatureCollection;
  skipped: number;
  /** Local photo files aligned with imported features; populated for photo-cluster CSVs. */
  photoGroups: ImportedCollectionPhoto[][];
}

function propertyValue(
  properties: Record<string, unknown>,
  name: string
): unknown {
  const key = Object.keys(properties).find(
    (candidate) => candidate.toLowerCase() === name
  );
  return key ? properties[key] : undefined;
}

function validCoordinate(
  longitude: unknown,
  latitude: unknown
): longitude is number {
  return (
    typeof longitude === "number" &&
    typeof latitude === "number" &&
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -90 &&
    latitude <= 90
  );
}

/** Group the photo_gps.py CSV format into one observation per cluster. */
function importPhotoClusters(
  source: FeatureCollection
): ImportedCollectionPoints | null {
  const sample = source.features.find(
    (feature) => feature.properties
  )?.properties;
  if (!sample) return null;
  const keys = Object.keys(sample).map((key) => key.toLowerCase());
  if (
    !["filename", "path", "cluster_id", "cluster_lon", "cluster_lat"].every(
      (key) => keys.includes(key)
    )
  ) {
    return null;
  }

  const groups = new Map<
    string,
    { feature: Feature<Point>; photos: ImportedCollectionPhoto[] }
  >();
  let skipped = 0;
  for (const feature of source.features) {
    const properties = { ...(feature.properties ?? {}) } as Record<
      string,
      unknown
    >;
    const id = String(propertyValue(properties, "cluster_id") ?? "").trim();
    const longitude = Number(propertyValue(properties, "cluster_lon"));
    const latitude = Number(propertyValue(properties, "cluster_lat"));
    if (!id || !validCoordinate(longitude, latitude)) {
      skipped += 1;
      continue;
    }

    let group = groups.get(id);
    if (!group) {
      for (const key of Object.keys(properties)) {
        if (
          [
            "filename",
            "path",
            "longitude",
            "latitude",
            "altitude_m",
            "id",
            "name",
          ].includes(key.toLowerCase())
        ) {
          delete properties[key];
        }
      }
      properties.id = id;
      properties.name = id;
      properties[OBSERVATION_NAME_PROPERTY] = id;
      group = {
        feature: {
          type: "Feature",
          id,
          geometry: { type: "Point", coordinates: [longitude, latitude] },
          properties,
        },
        photos: [],
      };
      groups.set(id, group);
    }
    const path = String(
      propertyValue(feature.properties ?? {}, "path") ?? ""
    ).trim();
    const name = String(
      propertyValue(feature.properties ?? {}, "filename") ?? ""
    ).trim();
    if (path && name) group.photos.push({ path, name });
  }

  const grouped = [...groups.values()];
  return {
    data: {
      type: "FeatureCollection",
      features: grouped.map(({ feature }) => feature),
    },
    skipped,
    photoGroups: grouped.map(({ photos }) => photos),
  };
}

/** Normalize point features from CSV/Shapefile into editable survey observations. */
export function importCollectionPoints(
  source: FeatureCollection
): ImportedCollectionPoints {
  const photoClusters = importPhotoClusters(source);
  if (photoClusters) return photoClusters;

  const features: Feature<Point>[] = [];
  const ids = new Set<string>();
  let skipped = 0;

  for (const feature of source.features) {
    const coordinates =
      feature.geometry?.type === "Point" ? feature.geometry.coordinates : null;
    const longitude = coordinates?.[0];
    const latitude = coordinates?.[1];
    if (!validCoordinate(longitude, latitude)) {
      skipped += 1;
      continue;
    }

    const properties = { ...(feature.properties ?? {}) } as Record<
      string,
      unknown
    >;
    const rawId = propertyValue(properties, "id") ?? feature.id;
    const baseId =
      (typeof rawId === "string" || typeof rawId === "number") &&
      String(rawId).trim()
        ? String(rawId).trim()
        : `point-${features.length + 1}`;
    let id = baseId;
    for (let suffix = 2; ids.has(id); suffix += 1) id = `${baseId}_${suffix}`;
    ids.add(id);

    const rawName = propertyValue(properties, "name");
    const name =
      (typeof rawName === "string" || typeof rawName === "number") &&
      String(rawName).trim()
        ? String(rawName).trim()
        : id;
    for (const key of Object.keys(properties)) {
      if (["id", "name"].includes(key.toLowerCase())) delete properties[key];
    }
    properties.id = id;
    properties.name = name;
    properties[OBSERVATION_NAME_PROPERTY] = name;
    features.push({
      ...feature,
      id,
      geometry: feature.geometry,
      properties,
    } as Feature<Point>);
  }

  return {
    data: { type: "FeatureCollection", features },
    skipped,
    photoGroups: features.map(() => []),
  };
}

/** True when a layer is a field-collection target (geojson + tagged metadata). */
export function isCollectionLayer(layer: CollectionLayerLike): boolean {
  return (
    layer.type === "geojson" && layer.metadata?.[FIELD_COLLECTION_FLAG] === true
  );
}

/** Read a layer's stored collection schema, defaulting to an empty schema. */
export function getSchema(layer: CollectionLayerLike): CollectionSchema {
  const raw = layer.metadata?.[COLLECTION_SCHEMA_KEY];
  if (
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as Partial<CollectionSchema>).fields)
  ) {
    return raw as CollectionSchema;
  }
  return { fields: [] };
}

/**
 * Read stable attachment keys. Explicit metadata is authoritative. For older
 * projects without metadata, preferred keys are claimed only when every value
 * has the strict shape written by Field Collection; ambiguous imported columns
 * are left untouched and a collision-safe fallback is selected instead.
 */
export function getCollectionAttachmentKeys(
  layer: CollectionLayerLike
): CollectionAttachmentKeys {
  const storedKeys = fieldCollectionAttachmentKeysFromMetadata(layer.metadata);
  if (storedKeys) return storedKeys;

  const occupied = getSchema(layer).fields.map((field) => field.key);
  const features = layer.geojson?.features ?? [];
  const valuesFor = (key: string): unknown[] =>
    features
      .filter((feature) =>
        Object.prototype.hasOwnProperty.call(feature.properties ?? {}, key)
      )
      .map((feature) => feature.properties?.[key]);
  const propertyKeys = features.flatMap((feature) =>
    Object.keys(feature.properties ?? {})
  );

  const primaryValues = valuesFor(PHOTO_PROPERTY);
  const primaryOwned =
    primaryValues.length > 0 && primaryValues.every(isInlineImage);
  const additionalValues = valuesFor(PHOTOS_PROPERTY);
  const additionalOwned =
    additionalValues.length > 0 &&
    additionalValues.every(
      (value) =>
        Array.isArray(value) && value.length > 0 && value.every(isInlineImage)
    );
  const noteValues = valuesFor(NOTES_PROPERTY);
  // A string array alone cannot prove ownership (imported GeoJSON commonly has
  // array-valued columns). Only associate legacy notes when the same layer also
  // contains a strictly recognized Field Collection image attachment.
  const notesOwned =
    (primaryOwned || additionalOwned) &&
    noteValues.length > 0 &&
    noteValues.every(
      (value) =>
        Array.isArray(value) &&
        value.length > 0 &&
        value.every(
          (note) => typeof note === "string" && note.trim().length > 0
        )
    );
  const bearingValues = valuesFor(PHOTO_BEARINGS_PROPERTY);
  const bearingsOwned =
    bearingValues.length > 0 &&
    bearingValues.every((value, valueIndex) => {
      if (!Array.isArray(value)) return false;
      const feature = features.filter((candidate) =>
        Object.prototype.hasOwnProperty.call(
          candidate.properties ?? {},
          PHOTO_BEARINGS_PROPERTY
        )
      )[valueIndex];
      const primary = feature?.properties?.[PHOTO_PROPERTY];
      const additional = feature?.properties?.[PHOTOS_PROPERTY];
      const photoCount =
        (isInlineImage(primary) ? 1 : 0) +
        (Array.isArray(additional) && additional.every(isInlineImage)
          ? additional.length
          : 0);
      return (
        photoCount > 0 &&
        value.length === photoCount &&
        value.every(
          (bearing) =>
            bearing == null ||
            (typeof bearing === "number" &&
              Number.isFinite(bearing) &&
              bearing >= 0 &&
              bearing < 360)
        )
      );
    });

  const foreignPreferred = [
    !primaryOwned && primaryValues.length > 0 ? PHOTO_PROPERTY : null,
    !additionalOwned && additionalValues.length > 0 ? PHOTOS_PROPERTY : null,
    !bearingsOwned && bearingValues.length > 0 ? PHOTO_BEARINGS_PROPERTY : null,
    !notesOwned && noteValues.length > 0 ? NOTES_PROPERTY : null,
  ].filter((key): key is string => key != null);
  return collectionAttachmentKeys(
    [...occupied, ...foreignPreferred],
    propertyKeys
  );
}

export interface FieldCollectionPointStats {
  points: number;
  pointsWithPhotos: number;
  photos: number;
}

/** Summarize point observations and their photo attachments across collection layers. */
export function fieldCollectionPointStats(
  layers: readonly CollectionLayerLike[]
): FieldCollectionPointStats {
  const stats = { points: 0, pointsWithPhotos: 0, photos: 0 };
  for (const layer of layers) {
    if (!isCollectionLayer(layer)) continue;
    const attachmentKeys = getCollectionAttachmentKeys(layer);
    for (const feature of layer.geojson?.features ?? []) {
      if (feature.geometry?.type !== "Point") continue;
      stats.points += 1;
      const photos = readCollectionAttachments(
        feature.properties,
        [],
        attachmentKeys
      ).photos.length;
      if (photos > 0) stats.pointsWithPhotos += 1;
      stats.photos += photos;
    }
  }
  return stats;
}

/** Read a layer's captured geometry type, defaulting to `point`. */
export function getGeometryType(layer: CollectionLayerLike): GeometryType {
  const g = layer.metadata?.[COLLECTION_GEOMETRY_KEY];
  return g === "line" || g === "polygon" ? g : "point";
}

/** Minimum vertices a geometry needs before it can be finished/saved. */
export function minVertices(geometry: GeometryType): number {
  if (geometry === "polygon") return 3;
  if (geometry === "line") return 2;
  return 1;
}

/** Build the metadata patch that tags a layer as a collection layer. */
export function collectionMetadata(
  schema: CollectionSchema,
  geometry: GeometryType = "point",
  existing: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...existing,
    [FIELD_COLLECTION_FLAG]: true,
    [COLLECTION_SCHEMA_KEY]: schema,
    [COLLECTION_GEOMETRY_KEY]: geometry,
    [COLLECTION_ATTACHMENT_KEYS_KEY]: collectionAttachmentKeys(
      schema.fields.map((field) => field.key)
    ),
  };
}

/**
 * Slugify a human label into a safe property key, made unique against `taken`.
 * Empty/symbol-only labels fall back to `field`, then `field_2`, `field_3`, …
 */
export function slugifyKey(
  label: string,
  taken: Iterable<string> = []
): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "field";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}

/**
 * Turn a list of draft fields (label + type, no keys yet) into a finalized
 * schema: blank labels are dropped and stable unique keys are assigned.
 */
export function buildSchema(
  drafts: Array<{
    label: string;
    type: FieldType;
    required?: boolean;
    options?: string[];
  }>
): CollectionSchema {
  const fields: CollectionField[] = [];
  // Reserve system-managed property keys so a user field (e.g. a "Photo" label
  // slugged to "photo") can't collide with the attached photo and be silently
  // overwritten when buildProperties merges the extras.
  const taken = new Set<string>(RESERVED_PROPERTY_KEYS);
  for (const draft of drafts) {
    if (!draft.label.trim()) continue;
    const key = slugifyKey(draft.label, taken);
    taken.add(key);
    const field: CollectionField = {
      key,
      label: draft.label.trim(),
      type: draft.type,
    };
    if (draft.required) field.required = true;
    if (draft.type === "choice" && draft.options?.length) {
      field.options = draft.options;
    }
    fields.push(field);
  }
  return { fields };
}

/** Parse a comma-separated options string into a trimmed, de-duplicated list. */
export function parseOptions(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(",")) {
    const v = part.trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/** Normalize a raw form string into the typed value stored on the feature. */
export function coerceValue(
  type: FieldType,
  raw: string
): string | number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (type === "number") {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  // text, date (kept as an ISO yyyy-mm-dd string), and choice are stored verbatim.
  return trimmed;
}

export interface ValidationResult {
  ok: boolean;
  /** Field key → error code (`required` | `number` | `choice`). */
  errors: Record<string, string>;
}

/** Validate raw form values against a schema before building a feature. */
export function validateForm(
  schema: CollectionSchema,
  values: Record<string, string>
): ValidationResult {
  const errors: Record<string, string> = {};
  for (const field of schema.fields) {
    const raw = values[field.key] ?? "";
    const coerced = coerceValue(field.type, raw);
    if (field.required && coerced === null) {
      errors[field.key] = "required";
      continue;
    }
    if (field.type === "number" && raw.trim() !== "" && coerced === null) {
      errors[field.key] = "number";
    } else if (
      field.type === "choice" &&
      coerced !== null &&
      field.options &&
      field.options.length > 0 &&
      !field.options.includes(String(coerced))
    ) {
      errors[field.key] = "choice";
    }
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/** Build a typed properties object from raw form values plus any extras. */
export function buildProperties(
  schema: CollectionSchema,
  values: Record<string, string>,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const field of schema.fields) {
    const v = coerceValue(field.type, values[field.key] ?? "");
    if (v !== null) props[field.key] = v;
  }
  return { ...props, ...extra };
}

/**
 * Like {@link buildProperties}, but fields configured in the layer's Attribute
 * Form designer coerce by their edit widget instead of the schema's field type
 * (a `number`/`range` widget stores a number, a `checkbox` stores a boolean),
 * so constraint expressions and downstream styling see properly typed values.
 */
export function buildPropertiesWithForm(
  schema: CollectionSchema,
  values: Record<string, string>,
  form: AttributeFormConfig | undefined,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const field of schema.fields) {
    const config = getAttributeFormField(form, field.key);
    const raw = values[field.key] ?? "";
    const v = config
      ? coerceAttributeFormValue(config, raw)
      : coerceValue(field.type, raw);
    if (v !== null) props[field.key] = v;
  }
  return { ...props, ...extra };
}

/** Construct a GeoJSON point feature at the given coordinate. */
export function makePointFeature(
  lng: number,
  lat: number,
  properties: Record<string, unknown>
): Feature<Point> {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties,
  };
}

/** Construct a GeoJSON LineString feature from captured vertices. */
export function makeLineFeature(
  coords: Vertex[],
  properties: Record<string, unknown>
): Feature<LineString> {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: coords.map((c) => [...c]) },
    properties,
  };
}

/**
 * Construct a GeoJSON Polygon feature from captured vertices, closing the ring
 * (repeating the first vertex at the end) if the caller didn't already.
 */
export function makePolygonFeature(
  coords: Vertex[],
  properties: Record<string, unknown>
): Feature<Polygon> {
  const ring: Vertex[] = coords.map((c) => [...c] as Vertex);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    ring.push([...first] as Vertex);
  }
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [ring] },
    properties,
  };
}

/** Build the appropriate feature for a geometry type from captured vertices. */
export function buildGeometryFeature(
  geometry: GeometryType,
  coords: Vertex[],
  properties: Record<string, unknown>
): Feature {
  if (geometry === "line") return makeLineFeature(coords, properties);
  if (geometry === "polygon") return makePolygonFeature(coords, properties);
  const pt = coords[0];
  if (!pt) throw new Error("buildGeometryFeature: a point needs one vertex");
  return makePointFeature(pt[0], pt[1], properties);
}

/** Read editable vertices from a feature of the layer's configured geometry. */
export function featureVertices(
  feature: Feature,
  geometry: GeometryType
): Vertex[] | null {
  let raw: unknown;
  if (geometry === "point" && feature.geometry?.type === "Point") {
    raw = [feature.geometry.coordinates];
  } else if (geometry === "line" && feature.geometry?.type === "LineString") {
    raw = feature.geometry.coordinates;
  } else if (geometry === "polygon" && feature.geometry?.type === "Polygon") {
    raw = feature.geometry.coordinates[0];
  } else return null;
  if (!Array.isArray(raw)) return null;

  const vertices = raw
    .filter(
      (coord): coord is number[] =>
        Array.isArray(coord) &&
        coord.length >= 2 &&
        Number.isFinite(coord[0]) &&
        Number.isFinite(coord[1])
    )
    .map((coord) => [coord[0], coord[1]] as Vertex);
  if (geometry === "polygon" && vertices.length > 1) {
    const first = vertices[0];
    const last = vertices.at(-1)!;
    if (first[0] === last[0] && first[1] === last[1]) vertices.pop();
  }
  return vertices.length >= minVertices(geometry) ? vertices : null;
}

/** Find a selected observation by its GeoJSON id, or by its legacy array index. */
export function findCollectionFeatureIndex(
  features: readonly Feature[],
  selectedId: string
): number {
  const byId = features.findIndex(
    (feature) => feature.id != null && String(feature.id) === selectedId
  );
  if (byId >= 0) return byId;
  const index = Number(selectedId);
  return Number.isInteger(index) && index >= 0 && index < features.length
    ? index
    : -1;
}

/** Delete one feature immutably; an invalid index leaves the collection unchanged. */
export function removeFeature(
  fc: FeatureCollection,
  index: number
): FeatureCollection {
  if (!Number.isInteger(index) || index < 0 || index >= fc.features.length)
    return fc;
  return {
    ...fc,
    features: fc.features.filter((_, i) => i !== index),
  };
}

/** Replace one feature immutably; an invalid index leaves the collection unchanged. */
export function replaceFeature(
  fc: FeatureCollection,
  index: number,
  feature: Feature
): FeatureCollection {
  if (!Number.isInteger(index) || index < 0 || index >= fc.features.length)
    return fc;
  return {
    ...fc,
    features: fc.features.map((current, i) =>
      i === index ? feature : current
    ),
  };
}

/**
 * A GeoJSON preview of in-progress drawing: a vertex point per coordinate, the
 * connecting line, and — for a polygon with enough vertices — the closed,
 * fillable ring so the user sees the finished shape before saving.
 */
export function drawPreview(
  geometry: GeometryType,
  coords: Vertex[]
): FeatureCollection {
  const features: Feature[] = coords.map((c, i) =>
    makePointFeature(c[0], c[1], { index: i })
  );
  if (geometry === "polygon" && coords.length >= 3) {
    features.push(makePolygonFeature(coords, {}));
    // Close the dashed stroke so it matches the filled ring (back to the start).
    features.push(makeLineFeature([...coords, coords[0]], {}));
  } else if (
    (geometry === "line" || geometry === "polygon") &&
    coords.length >= 2
  ) {
    features.push(makeLineFeature(coords, {}));
  }
  return { type: "FeatureCollection", features };
}

/** Return a new FeatureCollection with `feature` appended (immutably). */
export function appendFeature(
  fc: FeatureCollection,
  feature: Feature
): FeatureCollection {
  return { type: "FeatureCollection", features: [...fc.features, feature] };
}
