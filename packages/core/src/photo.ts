/**
 * Feature-property keys for inline photo images, shared by the app and the map
 * package so neither hardcodes a second copy that could drift. These keys are
 * part of the project schema: they are serialized into `.geolibre.json` on a
 * geotagged-photo or field-collection layer.
 */

/** Primary photo source: an inline data URL or a native `content://` URI. */
export const PHOTO_PROPERTY = "photo";

/**
 * Property key containing additional inline photos attached to the same feature.
 * The primary image remains under {@link PHOTO_PROPERTY} for compatibility.
 */
export const PHOTOS_PROPERTY = "geolibre_photos";

/** Ordered camera-facing azimuths aligned with the primary and additional photos. */
export const PHOTO_BEARINGS_PROPERTY = "geolibre_photo_bearings";

/** Ordered display names aligned with the primary and additional photos. */
export const PHOTO_NAMES_PROPERTY = "geolibre_photo_names";

/** Layer-metadata key recording collision-safe Field Collection attachment properties. */
export const FIELD_COLLECTION_ATTACHMENT_KEYS_METADATA = "collectionAttachmentKeys";

export interface FieldCollectionAttachmentKeys {
  photo: string;
  photos: string;
  photoBearings: string;
  photoNames: string;
  notes: string;
}

/** Read explicitly persisted Field Collection attachment keys from layer metadata. */
export function fieldCollectionAttachmentKeysFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): FieldCollectionAttachmentKeys | null {
  const raw = metadata?.[FIELD_COLLECTION_ATTACHMENT_KEYS_METADATA];
  if (!raw || typeof raw !== "object") return null;
  const keys = raw as Partial<FieldCollectionAttachmentKeys>;
  // Older projects predate photo names; use the reserved default key.
  const photoNames = keys.photoNames ?? PHOTO_NAMES_PROPERTY;
  const values = [keys.photo, keys.photos, keys.photoBearings, photoNames, keys.notes];
  if (
    !values.every((value): value is string => typeof value === "string" && value.length > 0) ||
    new Set(values).size !== values.length
  ) {
    return null;
  }
  return {
    photo: keys.photo!,
    photos: keys.photos!,
    photoBearings: keys.photoBearings!,
    photoNames,
    notes: keys.notes!,
  };
}

export type PhotoSourceResolver = (source: string) => Promise<string>;
let photoSourceResolver: PhotoSourceResolver | null = null;

/** Install the host-specific reader used for native content URIs. */
export function setPhotoSourceResolver(resolver: PhotoSourceResolver | null): void {
  photoSourceResolver = resolver;
}

/** Resolve an inline image unchanged, or load a native photo on demand. */
export function resolvePhotoSource(source: string): Promise<string> {
  if (!source.startsWith("content://")) return Promise.resolve(source);
  return photoSourceResolver?.(source) ?? Promise.resolve("");
}

/**
 * Property key under which a geotagged photo's full-resolution image (a data URL
 * of the original, un-re-encoded bytes) is stored. {@link PHOTO_PROPERTY} holds
 * the small thumbnail shown on the map marker/popup; this holds the
 * native-resolution original used by the enlarged/fullscreen viewer and a "Save
 * image". Absent when the source is already at or below the thumbnail cap, or a
 * format a browser cannot display at native size (TIFF/HEIC).
 */
export const PHOTO_FULL_PROPERTY = "photo_full";
