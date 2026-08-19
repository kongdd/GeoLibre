import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import * as maplibregl from "maplibre-gl";
import type { Feature } from "geojson";
import type { MapController } from "@geolibre/map";
import {
  currentEditorIdentity,
  editorTrackingFieldNames,
  getAttributeFormField,
  isAttributeFormFieldVisible,
  resolvePhotoSource,
  resolveSvgSource,
  stampFeatureEditorTracking,
  useAppStore,
  validateAttributeFormValues,
  type AttributeFormConfig,
  type GeoLibreLayer,
} from "@geolibre/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  Separator,
  Textarea,
} from "@geolibre/ui";
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Crosshair,
  ImagePlus,
  Loader2,
  MapPin,
  Navigation,
  Pencil,
  Plus,
  Save,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  appendFeature,
  buildGeometryFeature,
  buildPropertiesWithForm,
  buildSchema,
  collectionAttachments,
  COLLECTION_ATTACHMENT_KEYS_KEY,
  collectionMetadata,
  type CollectionSchema,
  drawPreview,
  emptyFeatureCollection,
  featureVertices,
  findCollectionFeatureIndex,
  type FieldType,
  getCollectionAttachmentKeys,
  getGeometryType,
  getSchema,
  type GeometryType,
  isCollectionLayer,
  MAX_NOTE_LENGTH,
  MAX_NOTES_PER_FEATURE,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_FEATURE,
  MAX_TOTAL_PHOTO_BYTES,
  minVertices,
  OBSERVATION_NAME_PROPERTY,
  observationLabelStyle,
  parseOptions,
  readCollectionAttachments,
  removeFeature,
  replaceFeature,
  validateForm,
  type Vertex,
  withoutCollectionAttachments,
} from "../../lib/field-collection";
import { attributeFormErrorMessage } from "../../lib/attribute-form-messages";
import { getCurrentPosition } from "../../lib/geolocation";
import {
  readPhotoDirection,
  setObservationPhotoSink,
  type ObservationPhotoBatch,
} from "../../lib/geotagged-photos";
import {
  captureNativePhoto,
  nativeFieldMediaAvailable,
  openNativePhoto,
  pickNativePhotos,
  type NativePhoto,
} from "../../lib/field-media";
import {
  fixFromPosition,
  formatAccuracy,
  type GpsFix,
} from "../../lib/gps-tracking";
import {
  normalizePhotoBearing,
  photoBearingFromOrientation,
  requestPhotoBearingPermission,
} from "../../lib/photo-bearing";
import { releaseBodyPointerEvents } from "../../lib/radix-compat";
import { isCurrentCameraTask, readFieldPhoto } from "../../lib/field-photo";

interface FieldCollectionDialogProps {
  open: boolean;
  openFeature: { layerId: string; featureId: string } | null;
  onOpenChange: (open: boolean) => void;
  mapControllerRef: React.RefObject<MapController | null>;
  persistProject: (layers?: GeoLibreLayer[]) => Promise<boolean>;
}

const FIELD_TYPES: FieldType[] = ["text", "number", "date", "choice"];
const GEOMETRY_TYPES: GeometryType[] = ["point", "line", "polygon"];

/** Transient map source/layers used to preview an in-progress line/polygon. */
const DRAW_SOURCE = "__fc_draw__";
const DRAW_COLOR = "#ef4444";
const HISTORY_POINT_MARKER_KEY = "fieldCollectionHistoryMarkerV2";
const OBSERVATION_LABELS_KEY = "fieldCollectionObservationLabels";
const HISTORY_POINT_MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="param(fill)" stroke="white" stroke-width="4"/><path fill="white" d="M23 17h18v30l-9-7-9 7z"/></svg>`;
const FIELD_MARKER_SHAPES = [
  "circle",
  "square",
  "triangle",
  "diamond",
  "star",
  "cross",
  "pin",
] as const;
const FIELD_MARKER_ICONS = [
  {
    id: "reservoir",
    labelKey: "fieldCollection.markerIcons.reservoir",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="29" fill="param(fill)" stroke="white" stroke-width="3"/><g fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 24h30M10 33h24M10 42h18"/><path d="M43 16v32H26z"/></g></svg>`,
  },
  {
    id: "hydrologicalStation",
    labelKey: "fieldCollection.markerIcons.hydrologicalStation",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="29" fill="param(fill)" stroke="white" stroke-width="3"/><g fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 24l14-10 14 10v19H18zM32 14V8M28 8h8M26 43V31h12v12M10 49c4-4 8 4 12 0s8 4 12 0 8 4 12 0 8 4 12 0"/></g></svg>`,
  },
  {
    id: "waterLevelStation",
    labelKey: "fieldCollection.markerIcons.waterLevelStation",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="29" fill="param(fill)" stroke="white" stroke-width="3"/><g fill="none" stroke="white" stroke-width="4" stroke-linecap="round"><path d="M22 12v38M22 18h9M22 26h6M22 34h9"/><path d="M12 42c5-5 10 5 15 0s10 5 15 0 10 5 15 0M12 50c5-5 10 5 15 0s10 5 15 0 10 5 15 0"/></g></svg>`,
  },
  {
    id: "rainGaugeStation",
    labelKey: "fieldCollection.markerIcons.rainGaugeStation",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="29" fill="param(fill)" stroke="white" stroke-width="3"/><g fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M17 15h30l-8 12v23H25V27zM25 34h8M25 42h8"/><path d="M22 8l-2 3M32 7v4M42 8l2 3"/></g></svg>`,
  },
  {
    id: "house",
    labelKey: "fieldCollection.markerIcons.house",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="29" fill="param(fill)" stroke="white" stroke-width="3"/><g fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 30L32 13l20 17M18 27v23h28V27M27 50V36h10v14"/></g></svg>`,
  },
  {
    id: "bridge",
    labelKey: "fieldCollection.markerIcons.bridge",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="29" fill="param(fill)" stroke="white" stroke-width="3"/><g fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 25h44M14 19v12M50 19v12M14 46V31h36v15M14 46c5-16 13-16 18 0 5-16 13-16 18 0M10 50h44"/></g></svg>`,
  },
] as const;
const HISTORY_POINT_STYLE = {
  markerEnabled: true,
  markerShape: "custom",
  markerColor: "#00a8c4",
  markerSvg: HISTORY_POINT_MARKER_SVG,
  markerSize: 48,
} as const;

type CompassOrientationEvent = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};

type TimedBearing = { value: number; timestamp: number };

interface DraftField {
  id: number;
  label: string;
  type: FieldType;
  required: boolean;
  optionsText: string;
}

function newDraftField(id: number): DraftField {
  return { id, label: "", type: "text", required: false, optionsText: "" };
}

function formatLatLng(lng: number, lat: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function formatPhotoBearing(value: number): string {
  return `${Number(value.toFixed(1))}°`;
}

function newObservationId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `field-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

/** Move keyboard focus after React has committed the replacement capture UI. */
function focusAfterRender(selector: string): void {
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(selector)?.focus();
  });
}

/** Add/update the transient drawing preview on the map. */
function syncDrawPreview(
  map: maplibregl.Map,
  geometry: GeometryType,
  verts: Vertex[]
): void {
  const data = drawPreview(geometry, verts);
  const src = map.getSource(DRAW_SOURCE) as
    | maplibregl.GeoJSONSource
    | undefined;
  if (src) {
    src.setData(data);
    return;
  }
  map.addSource(DRAW_SOURCE, { type: "geojson", data });
  map.addLayer({
    id: `${DRAW_SOURCE}-fill`,
    type: "fill",
    source: DRAW_SOURCE,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "fill-color": DRAW_COLOR, "fill-opacity": 0.2 },
  });
  map.addLayer({
    id: `${DRAW_SOURCE}-line`,
    type: "line",
    source: DRAW_SOURCE,
    filter: ["==", ["geometry-type"], "LineString"],
    paint: {
      "line-color": DRAW_COLOR,
      "line-width": 2,
      "line-dasharray": [2, 1],
    },
  });
  map.addLayer({
    id: `${DRAW_SOURCE}-pt`,
    type: "circle",
    source: DRAW_SOURCE,
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 4,
      "circle-color": DRAW_COLOR,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1,
    },
  });
}

function removeDrawPreview(map: maplibregl.Map): void {
  for (const id of [
    `${DRAW_SOURCE}-fill`,
    `${DRAW_SOURCE}-line`,
    `${DRAW_SOURCE}-pt`,
  ]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(DRAW_SOURCE)) map.removeSource(DRAW_SOURCE);
}

/**
 * Field Collection: capture point, line, or polygon observations against a
 * custom attribute form, placing geometry by GPS or by tapping the map. Captures
 * are written to a tagged `geojson` collection layer in the store, so they
 * persist in the project, show in the attribute table, export, and work offline.
 * Designed mobile-first to pair with the native Android build and tile cache.
 */
export function FieldCollectionDialog({
  open,
  openFeature,
  onOpenChange,
  mapControllerRef,
  persistProject,
}: FieldCollectionDialogProps) {
  const { t } = useTranslation();
  const layers = useAppStore((s) => s.layers);
  const addGeoJsonLayer = useAppStore((s) => s.addGeoJsonLayer);
  const updateLayer = useAppStore((s) => s.updateLayer);
  const selectedLayerId = useAppStore((s) => s.selectedLayerId);

  const collectionLayers = useMemo(
    () => layers.filter((l) => isCollectionLayer(l)),
    [layers]
  );

  // Upgrade existing point collections once without overwriting later edits.
  useEffect(() => {
    for (const layer of collectionLayers) {
      if (getGeometryType(layer) !== "point") continue;
      const addMarker = layer.metadata?.[HISTORY_POINT_MARKER_KEY] !== true;
      const addLabels = layer.metadata?.[OBSERVATION_LABELS_KEY] !== true;
      const labels = layer.style.labels;
      const tightenLabels =
        !addLabels &&
        labels.enabled &&
        labels.field === OBSERVATION_NAME_PROPERTY &&
        labels.anchor === "bottom" &&
        [-3.25, -2, -1.6].includes(labels.offsetY);
      if (!addMarker && !addLabels && !tightenLabels) continue;
      updateLayer(layer.id, {
        metadata: {
          ...(layer.metadata ?? {}),
          [HISTORY_POINT_MARKER_KEY]: true,
          [OBSERVATION_LABELS_KEY]: true,
        },
        style: {
          ...layer.style,
          ...(addMarker ? HISTORY_POINT_STYLE : {}),
          ...(addLabels
            ? { labels: observationLabelStyle(labels) }
            : tightenLabels
              ? { labels: { ...labels, offsetY: observationLabelStyle(labels).offsetY } }
              : {}),
        },
      });
    }
  }, [collectionLayers, updateLayer]);

  // Target layer: "" means "create a new layer" (the setup step is shown).
  const [layerId, setLayerId] = useState<string>("");
  const [layerName, setLayerName] = useState("");
  const [geometry, setGeometry] = useState<GeometryType>("point");
  const [drafts, setDrafts] = useState<DraftField[]>([]);

  // Capture state. `pending` holds the captured coordinate(s) awaiting attributes.
  const [pending, setPending] = useState<Vertex[] | null>(null);
  const [observationName, setObservationName] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<string[]>([""]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoNames, setPhotoNames] = useState<string[]>([]);
  const [photoBearings, setPhotoBearings] = useState<(number | null)[]>([]);
  const photoAttachmentsRef = useRef({
    photos,
    photoNames,
    photoBearings,
  });
  photoAttachmentsRef.current = { photos, photoNames, photoBearings };
  const [attachmentsDirty, setAttachmentsDirty] = useState(false);
  const [readingPhotos, setReadingPhotos] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [collectingPhotoBearing, setCollectingPhotoBearing] = useState(false);
  const [picking, setPicking] = useState(false); // point: one-shot map click
  const [drawing, setDrawing] = useState(false); // line/polygon: multi-vertex
  const [vertices, setVertices] = useState<Vertex[]>([]);
  const [locating, setLocating] = useState(false);
  const [lastGpsFix, setLastGpsFix] = useState<GpsFix | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [editingFeatureId, setEditingFeatureId] = useState<
    string | number | null
  >(null);
  // Index identifies legacy observations whose id is absent or duplicated.
  // It remains draft-only until Update, so entering/cancelling edit mode never
  // mutates the project merely to manufacture a stable id.
  const [editingFeatureIndex, setEditingFeatureIndex] = useState<number | null>(
    null
  );
  // Running count of features saved this session, shown in the notice. A ref so
  // bumping it neither re-renders nor runs a side effect inside a state updater.
  const savedCountRef = useRef(0);

  const markerRef = useRef<maplibregl.Marker | null>(null);
  // Set just before we reopen the dialog after a map capture, so the open-reset
  // effect below doesn't wipe the freshly captured geometry/form.
  const suppressResetRef = useRef(false);
  // True while the tool is in use; gates async GPS callbacks so a fix that
  // arrives after the dialog is dismissed doesn't mutate the map/state.
  const activeRef = useRef(false);
  // Guards save/create handlers against duplicate writes from fast double taps.
  const creatingRef = useRef(false);
  const savingRef = useRef(false);
  const openedSelectionRef = useRef<string | null>(null);
  // Per-instance monotonic id for draft-field React keys.
  const draftIdRef = useRef(0);
  const makeDraft = useCallback(
    () => newDraftField((draftIdRef.current += 1)),
    []
  );
  // Mirrors `vertices` so the map double-click handler can finish synchronously.
  const verticesRef = useRef<Vertex[]>([]);
  // Bumped on each GPS request and on any other capture, so a slow GPS fix that
  // resolves after a newer capture is ignored instead of overwriting it.
  const gpsSeqRef = useRef(0);
  // Invalidates asynchronous FileReader work when the capture is reset or saved.
  const photoSeqRef = useRef(0);
  // Independent from the draft barrier: a newer camera launch must not be
  // cleaned up by an older photo task finishing later.
  const cameraSessionIdRef = useRef(0);
  const latestPhotoBearingRef = useRef<TimedBearing | null>(null);
  const cameraBearingRef = useRef<number | null>(null);
  const cameraStartedAtRef = useRef(0);
  const photoBearingPermissionRef = useRef<
    "unknown" | "pending" | "granted" | "denied"
  >("unknown");
  // Restores an edited line/polygon if replacement drawing is cancelled.
  const editingVerticesRef = useRef<Vertex[] | null>(null);

  useEffect(() => {
    activeRef.current = open || picking || drawing;
  }, [open, picking, drawing]);

  useEffect(
    () => () => {
      photoSeqRef.current += 1;
    },
    []
  );

  useEffect(() => {
    if (!open || !pending || !collectingPhotoBearing) {
      latestPhotoBearingRef.current = null;
      return;
    }
    const onOrientation = (rawEvent: Event) => {
      const event = rawEvent as CompassOrientationEvent;
      const absoluteReading =
        rawEvent.type === "deviceorientationabsolute" ||
        event.absolute ||
        typeof event.webkitCompassHeading === "number";
      // Android may emit a relative `deviceorientation` event beside the
      // absolute stream; it must neither replace nor invalidate the compass.
      if (!absoluteReading) return;
      const bearing = photoBearingFromOrientation({
        alpha: event.alpha,
        beta: event.beta,
        gamma: event.gamma,
        absolute:
          event.absolute || rawEvent.type === "deviceorientationabsolute",
        webkitCompassHeading: event.webkitCompassHeading,
        webkitCompassAccuracy: event.webkitCompassAccuracy,
      });
      latestPhotoBearingRef.current =
        bearing == null ? null : { value: bearing, timestamp: Date.now() };
    };
    window.addEventListener("deviceorientationabsolute", onOrientation);
    window.addEventListener("deviceorientation", onOrientation);
    return () => {
      window.removeEventListener("deviceorientationabsolute", onOrientation);
      window.removeEventListener("deviceorientation", onOrientation);
      latestPhotoBearingRef.current = null;
    };
  }, [collectingPhotoBearing, open, pending]);

  // Allow creating again after returning to the "new layer" setup step.
  useEffect(() => {
    if (!layerId) creatingRef.current = false;
  }, [layerId]);

  const activeLayer = layerId
    ? layers.find((l) => l.id === layerId) ?? null
    : null;
  const schema: CollectionSchema | null = activeLayer
    ? getSchema(activeLayer)
    : null;
  const attachmentKeys = activeLayer
    ? getCollectionAttachmentKeys(activeLayer)
    : null;
  const activeGeometry: GeometryType = activeLayer
    ? getGeometryType(activeLayer)
    : geometry;
  // The layer's Attribute Form designer config, narrowed to the collection
  // schema's own fields: a config for a field this form does not capture must
  // not block a save (its required/constraint rules have nothing to bind to).
  // Memoized so handleSave's useCallback and CaptureStep's prop keep a stable
  // identity across unrelated re-renders.
  const attributeForm: AttributeFormConfig | undefined = useMemo(() => {
    const form = activeLayer?.attributeForm;
    if (!form || !schema) return undefined;
    const keys = new Set(schema.fields.map((field) => field.key));
    const fields = form.fields.filter((field) => keys.has(field.field));
    return fields.length > 0 ? { fields } : undefined;
  }, [activeLayer, schema]);

  const getMap = useCallback(
    () => mapControllerRef.current?.getMap() ?? null,
    [mapControllerRef]
  );

  const clearMarker = useCallback(() => {
    markerRef.current?.remove();
    markerRef.current = null;
  }, []);

  const clearPreview = useCallback(() => {
    clearMarker();
    const map = getMap();
    if (map) removeDrawPreview(map);
  }, [clearMarker, getMap]);

  const resetObservationDraft = useCallback(
    (clearNotice = true) => {
      gpsSeqRef.current += 1;
      photoSeqRef.current += 1;
      cameraSessionIdRef.current += 1;
      setEditingFeatureId(null);
      setEditingFeatureIndex(null);
      editingVerticesRef.current = null;
      setPending(null);
      setObservationName("");
      setValues({});
      setNotes([""]);
      setPhotos([]);
      setPhotoNames([]);
      setPhotoBearings([]);
      setAttachmentsDirty(false);
      setReadingPhotos(false);
      setCollectingPhotoBearing(false);
      latestPhotoBearingRef.current = null;
      cameraBearingRef.current = null;
      cameraStartedAtRef.current = 0;
      setVertices([]);
      verticesRef.current = [];
      setLocating(false);
      setLastGpsFix(null);
      setErrors({});
      if (clearNotice) setNotice(null);
      clearPreview();
    },
    [clearPreview]
  );

  // Reset everything when the dialog opens; default to the first existing
  // collection layer if there is one, otherwise the "new layer" setup step.
  useEffect(() => {
    if (!open) return;
    // Reopened after a map capture — keep the captured state, skip the reset.
    if (suppressResetRef.current) {
      suppressResetRef.current = false;
      return;
    }
    const selected = collectionLayers.find(
      (layer) => layer.id === (openFeature?.layerId ?? selectedLayerId)
    );
    setLayerId(selected?.id ?? collectionLayers[0]?.id ?? "");
    setLayerName("");
    setGeometry("point");
    setDrafts([]);
    resetObservationDraft();
    savedCountRef.current = 0;
    // collectionLayers is derived from layers; intentionally snapshot on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resetObservationDraft]);

  // Tear down any preview when the dialog fully closes (not while drawing with
  // it intentionally hidden) and on unmount.
  useEffect(() => {
    if (!open && !picking && !drawing) clearPreview();
  }, [open, picking, drawing, clearPreview]);
  useEffect(() => () => clearPreview(), [clearPreview]);

  const showMarker = useCallback(
    (lng: number, lat: number) => {
      const map = getMap();
      if (!map) return;
      if (markerRef.current) {
        markerRef.current.setLngLat([lng, lat]);
      } else {
        const marker = new maplibregl.Marker({ color: "#ea4335", scale: 1.1 });
        marker.getElement().dataset.fieldCollectionMarker = "";
        marker.getElement().classList.add("pointer-events-none");
        markerRef.current = marker.setLngLat([lng, lat]).addTo(map);
      }
    },
    [getMap]
  );

  const recenter = useCallback(
    (lng: number, lat: number) => {
      mapControllerRef.current?.flyTo({
        center: [lng, lat],
        zoom: Math.max(getMap()?.getZoom() ?? 0, 15),
      });
    },
    [mapControllerRef, getMap]
  );

  // ---- Point capture (single coordinate) -------------------------------------

  const capturePoint = useCallback(
    (lng: number, lat: number, fly: boolean) => {
      setPending([[lng, lat]]);
      setErrors({});
      setNotice(null);
      if (!fly) setLastGpsFix(null);
      showMarker(lng, lat);
      if (fly) recenter(lng, lat);
    },
    [showMarker, recenter]
  );

  // Closing cancels any in-flight GPS fix so its async callback can't act on a
  // dismissed dialog (the activeRef effect lags a render behind the close).
  const handleClose = useCallback(() => {
    gpsSeqRef.current += 1;
    photoSeqRef.current += 1;
    cameraSessionIdRef.current += 1;
    setReadingPhotos(false);
    setCollectingPhotoBearing(false);
    latestPhotoBearingRef.current = null;
    cameraBearingRef.current = null;
    cameraStartedAtRef.current = 0;
    onOpenChange(false);
  }, [onOpenChange]);

  const handlePickOnMap = useCallback(() => {
    if (!getMap()) return;
    gpsSeqRef.current += 1; // invalidate any in-flight GPS fix
    setLocating(false); // its callback bails, so clear the spinner here
    setLastGpsFix(null);
    setPicking(true);
    onOpenChange(false);
  }, [getMap, onOpenChange]);

  // Cancel an active point-pick from the placement banner. Mirrors the Escape
  // path in the picking effect: stop picking and reopen the dialog without
  // capturing a point, suppressing the reopen reset so the in-progress form is
  // kept.
  const handleCancelPick = useCallback(() => {
    clearMarker();
    setPicking(false);
    suppressResetRef.current = true;
    onOpenChange(true);
  }, [clearMarker, onOpenChange]);

  useEffect(() => {
    if (!picking) return;
    const map = getMap();
    if (!map) {
      setPicking(false);
      return;
    }
    releaseBodyPointerEvents();
    const raf = requestAnimationFrame(releaseBodyPointerEvents);
    const canvas = map.getCanvas();
    const prevCursor = canvas.style.cursor;
    canvas.dataset.fieldCollectionCapture = "true";
    canvas.style.cursor = "crosshair";
    const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const updateCenterAim = () => {
      const center = map.getCenter();
      showMarker(center.lng, center.lat);
    };
    const updatePointerAim = (e: maplibregl.MapMouseEvent) => {
      showMarker(e.lngLat.lng, e.lngLat.lat);
    };
    updateCenterAim();
    if (coarsePointer) map.on("move", updateCenterAim);
    else map.on("mousemove", updatePointerAim);
    const handler = (e: maplibregl.MapMouseEvent) => {
      const target = coarsePointer ? map.getCenter() : e.lngLat;
      capturePoint(target.lng, target.lat, false);
      setPicking(false);
      suppressResetRef.current = true;
      onOpenChange(true);
    };
    // Escape aborts picking and restores the dialog without capturing.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCancelPick();
    };
    map.once("click", handler);
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      map.off("click", handler);
      map.off("move", updateCenterAim);
      map.off("mousemove", updatePointerAim);
      window.removeEventListener("keydown", onKey);
      delete canvas.dataset.fieldCollectionCapture;
      canvas.style.cursor = prevCursor;
    };
  }, [
    picking,
    getMap,
    onOpenChange,
    capturePoint,
    handleCancelPick,
    showMarker,
  ]);

  // ---- Line / polygon drawing (multi-vertex) ---------------------------------

  const setVerticesSynced = useCallback(
    (next: Vertex[]) => {
      verticesRef.current = next;
      setVertices(next);
      const map = getMap();
      if (map) syncDrawPreview(map, activeGeometry, next);
    },
    [getMap, activeGeometry]
  );

  const pushVertex = useCallback(
    (lng: number, lat: number) => {
      setVerticesSynced([...verticesRef.current, [lng, lat]]);
    },
    [setVerticesSynced]
  );

  const handleStartDrawing = useCallback(() => {
    if (!getMap()) return;
    gpsSeqRef.current += 1; // invalidate any in-flight GPS fix
    setLocating(false); // its callback bails, so clear the spinner here
    setLastGpsFix(null);
    setVerticesSynced([]);
    setPending(null);
    setNotice(null);
    setDrawing(true);
    onOpenChange(false);
  }, [getMap, onOpenChange, setVerticesSynced]);

  // Finish the current geometry: keep the preview visible (so the user sees the
  // finished shape while filling the form) and reopen the dialog.
  const finishDrawing = useCallback(
    (verts: Vertex[]) => {
      if (verts.length < minVertices(activeGeometry)) return;
      const map = getMap();
      if (map) syncDrawPreview(map, activeGeometry, verts);
      verticesRef.current = verts;
      setVertices(verts);
      setPending(verts);
      setErrors({});
      setNotice(null);
      setDrawing(false);
      suppressResetRef.current = true;
      onOpenChange(true);
    },
    [activeGeometry, getMap, onOpenChange]
  );

  const handleCancelDrawing = useCallback(() => {
    setDrawing(false);
    setLastGpsFix(null);
    const original =
      editingFeatureId != null ? editingVerticesRef.current : null;
    if (original) {
      setVerticesSynced(original);
      setPending(original);
    } else {
      setVerticesSynced([]);
      const map = getMap();
      if (map) removeDrawPreview(map);
    }
    setNotice(null);
    suppressResetRef.current = true;
    onOpenChange(true);
  }, [editingFeatureId, getMap, onOpenChange, setVerticesSynced]);

  useEffect(() => {
    if (!drawing) return;
    const map = getMap();
    if (!map) {
      setDrawing(false);
      return;
    }
    releaseBodyPointerEvents();
    const raf = requestAnimationFrame(releaseBodyPointerEvents);
    const canvas = map.getCanvas();
    const prevCursor = canvas.style.cursor;
    canvas.dataset.fieldCollectionCapture = "true";
    canvas.style.cursor = "crosshair";
    // Double-click finishes the geometry; disable the default zoom-on-dblclick
    // and drop the extra vertex the dblclick's second click added.
    map.doubleClickZoom.disable();
    const onClick = (e: maplibregl.MapMouseEvent) => {
      setLastGpsFix(null);
      pushVertex(e.lngLat.lng, e.lngLat.lat);
    };
    const onDblClick = (e: maplibregl.MapMouseEvent) => {
      e.preventDefault();
      finishDrawing(verticesRef.current.slice(0, -1));
    };
    // Escape aborts drawing (mirrors point-pick mode and the toolbar's Cancel).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCancelDrawing();
    };
    map.on("click", onClick);
    map.on("dblclick", onDblClick);
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      map.off("click", onClick);
      map.off("dblclick", onDblClick);
      window.removeEventListener("keydown", onKey);
      map.doubleClickZoom.enable();
      delete canvas.dataset.fieldCollectionCapture;
      canvas.style.cursor = prevCursor;
    };
  }, [drawing, getMap, pushVertex, finishDrawing, handleCancelDrawing]);

  const handleUndoVertex = useCallback(() => {
    setLastGpsFix(null);
    setVerticesSynced(verticesRef.current.slice(0, -1));
  }, [setVerticesSynced]);

  // ---- GPS (a point, or one vertex while drawing) ----------------------------

  const handleUseGps = useCallback(
    (asVertex: boolean) => {
      setLocating(true);
      setNotice(null);
      const seq = (gpsSeqRef.current += 1);
      // Ignore a fix that resolves after the tool was dismissed or superseded by
      // a newer capture (e.g. the user picked/drew a point while GPS was pending).
      const stale = () => !activeRef.current || seq !== gpsSeqRef.current;
      // On Tauri mobile this routes through the native geolocation plugin, which
      // requests the OS location permission first; elsewhere it wraps
      // navigator.geolocation. See lib/geolocation.ts.
      getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      })
        .then((pos) => {
          if (stale()) return;
          setLocating(false);
          setLastGpsFix(fixFromPosition(pos));
          const { longitude, latitude } = pos.coords;
          if (asVertex) {
            pushVertex(longitude, latitude);
            recenter(longitude, latitude);
          } else {
            // capturePoint(..., true) already recenters the map.
            capturePoint(longitude, latitude, true);
          }
        })
        .catch((err) => {
          if (stale()) return;
          setLocating(false);
          setNotice(
            t(
              err?.unavailable
                ? "fieldCollection.noGeolocation"
                : "fieldCollection.geolocationDenied"
            )
          );
        });
    },
    [t, pushVertex, capturePoint, recenter]
  );

  const handlePrepareCamera = useCallback((): boolean => {
    const cameraSessionId = (cameraSessionIdRef.current += 1);
    const orientation = globalThis.DeviceOrientationEvent as
      | (typeof DeviceOrientationEvent & {
          requestPermission?: () => Promise<"granted" | "denied">;
        })
      | undefined;
    if (
      orientation?.requestPermission &&
      photoBearingPermissionRef.current === "unknown"
    ) {
      photoBearingPermissionRef.current = "pending";
      setCollectingPhotoBearing(true);
      void requestPhotoBearingPermission().then((granted) => {
        if (cameraSessionId !== cameraSessionIdRef.current) return;
        photoBearingPermissionRef.current = granted ? "granted" : "denied";
        if (!granted) setCollectingPhotoBearing(false);
        setNotice(
          t(
            granted
              ? "fieldCollection.photoBearingPermissionReady"
              : "fieldCollection.photoBearingPermissionDenied"
          )
        );
      });
      // Keep the iOS permission request in this user activation, but require a
      // second tap to synchronously open the native camera/file chooser.
      return false;
    }
    if (photoBearingPermissionRef.current === "pending") return false;

    const canReadBearing = photoBearingPermissionRef.current !== "denied";
    setCollectingPhotoBearing(canReadBearing);
    // Only a fresh post-launch event or the photo's EXIF direction is trusted;
    // a pre-launch reading may no longer match the shutter direction.
    cameraBearingRef.current = null;
    cameraStartedAtRef.current = Date.now();
    return true;
  }, [t]);

  const handleCameraCancel = useCallback(() => {
    cameraSessionIdRef.current += 1;
    setCollectingPhotoBearing(false);
    latestPhotoBearingRef.current = null;
    cameraBearingRef.current = null;
    cameraStartedAtRef.current = 0;
  }, []);

  const handlePhotos = useCallback(
    async (
      e: React.ChangeEvent<HTMLInputElement>,
      source: "camera" | "gallery"
    ) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";
      if (files.length === 0) {
        if (source === "camera") handleCameraCancel();
        return;
      }

      const slots = MAX_PHOTOS_PER_FEATURE - photos.length;
      if (slots <= 0) {
        setNotice(
          t("fieldCollection.photoLimit", { max: MAX_PHOTOS_PER_FEATURE })
        );
        return;
      }

      const seq = (photoSeqRef.current += 1);
      const cameraSessionId = cameraSessionIdRef.current;
      setReadingPhotos(true);
      const selected = files.slice(0, slots);
      const loaded: string[] = [];
      const loadedNames: string[] = [];
      const loadedBearings: (number | null)[] = [];
      let totalBytes = photos.reduce((sum, photo) => sum + photo.length, 0);
      let issue: "limit" | "large" | "total" | "read" | "bearing" | null =
        files.length > selected.length ? "limit" : null;
      try {
        // The webview is paused while the native camera is open. Give its sensor
        // listener one frame after returning, then prefer EXIF GPSImgDirection.
        if (source === "camera") {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        const latest = latestPhotoBearingRef.current;
        const sensorBearing =
          source === "camera" &&
          latest &&
          latest.timestamp >= cameraStartedAtRef.current &&
          Date.now() - latest.timestamp <= 2_000
            ? latest.value
            : null;
        for (const file of selected) {
          const [result, exifBearing] = await Promise.all([
            readFieldPhoto(file),
            readPhotoDirection(file),
          ]);
          if (seq !== photoSeqRef.current) return;
          if (!result.dataUrl) {
            issue ??= result.issue ?? "read";
          } else if (
            totalBytes + result.dataUrl.length >
            MAX_TOTAL_PHOTO_BYTES
          ) {
            issue ??= "total";
          } else {
            loaded.push(result.dataUrl);
            loadedNames.push(file.name);
            loadedBearings.push(
              normalizePhotoBearing(exifBearing ?? sensorBearing)
            );
            totalBytes += result.dataUrl.length;
          }
        }
        if (
          source === "camera" &&
          loaded.length > 0 &&
          loadedBearings.every((v) => v == null)
        ) {
          issue ??= "bearing";
        }

        if (loaded.length > 0) {
          setAttachmentsDirty(true);
          setPhotos((current) =>
            [...current, ...loaded].slice(0, MAX_PHOTOS_PER_FEATURE)
          );
          setPhotoNames((current) =>
            [...current, ...loadedNames].slice(0, MAX_PHOTOS_PER_FEATURE)
          );
          setPhotoBearings((current) =>
            [...current, ...loadedBearings].slice(0, MAX_PHOTOS_PER_FEATURE)
          );
        }
        setNotice(
          issue === "limit"
            ? t("fieldCollection.photoLimit", { max: MAX_PHOTOS_PER_FEATURE })
            : issue === "large"
            ? t("fieldCollection.photoTooLarge", {
                max: `${Math.round(MAX_PHOTO_BYTES / (1024 * 1024))} MB`,
              })
            : issue === "total"
            ? t("fieldCollection.photoTotalTooLarge", {
                max: `${Math.round(MAX_TOTAL_PHOTO_BYTES / (1024 * 1024))} MB`,
              })
            : issue === "read"
            ? t("fieldCollection.photoReadError")
            : issue === "bearing"
            ? t("fieldCollection.photoBearingUnavailable")
            : null
        );
      } finally {
        if (
          source === "camera" &&
          isCurrentCameraTask(
            seq,
            photoSeqRef.current,
            cameraSessionId,
            cameraSessionIdRef.current
          )
        ) {
          cameraBearingRef.current = null;
          cameraStartedAtRef.current = 0;
          setCollectingPhotoBearing(false);
        }
        if (seq === photoSeqRef.current) setReadingPhotos(false);
      }
    },
    [handleCameraCancel, photos, t]
  );

  const handleNativePhotos = useCallback(
    async (source: "camera" | "gallery") => {
      const slots = MAX_PHOTOS_PER_FEATURE - photos.length;
      if (slots <= 0) {
        setNotice(t("fieldCollection.photoLimit", { max: MAX_PHOTOS_PER_FEATURE }));
        return;
      }
      if (source === "camera" && !handlePrepareCamera()) return;

      const seq = (photoSeqRef.current += 1);
      const cameraSessionId = cameraSessionIdRef.current;
      setReadingPhotos(true);
      try {
        let selected: NativePhoto[];
        if (source === "camera") {
          const photo = await captureNativePhoto();
          selected = photo ? [photo] : [];
        } else {
          selected = await pickNativePhotos(slots);
        }
        if (seq !== photoSeqRef.current || selected.length === 0) return;
        if (source === "camera") await new Promise((resolve) => setTimeout(resolve, 200));
        const latest = latestPhotoBearingRef.current;
        const sensorBearing =
          source === "camera" &&
          latest &&
          latest.timestamp >= cameraStartedAtRef.current &&
          Date.now() - latest.timestamp <= 2_000
            ? latest.value
            : null;
        const bearings = selected.map((photo) =>
          normalizePhotoBearing(photo.bearing ?? sensorBearing)
        );
        setAttachmentsDirty(true);
        setPhotos((current) => [...current, ...selected.map((photo) => photo.uri)]);
        setPhotoNames((current) => [...current, ...selected.map((photo) => photo.name)]);
        setPhotoBearings((current) => [...current, ...bearings]);
        setNotice(
          source === "camera" && bearings.every((bearing) => bearing == null)
            ? t("fieldCollection.photoBearingUnavailable")
            : null
        );
      } catch (error) {
        console.error("Could not save Field Survey photo", error);
        setNotice(t("fieldCollection.photoReadError"));
      } finally {
        if (
          source === "camera" &&
          isCurrentCameraTask(
            seq,
            photoSeqRef.current,
            cameraSessionId,
            cameraSessionIdRef.current
          )
        ) {
          cameraStartedAtRef.current = 0;
          setCollectingPhotoBearing(false);
        }
        if (seq === photoSeqRef.current) setReadingPhotos(false);
      }
    },
    [handlePrepareCamera, photos.length, t]
  );

  useEffect(() => {
    if (!open || (!pending && editingFeatureId == null)) {
      setObservationPhotoSink(null);
      return;
    }
    setObservationPhotoSink((incoming: ObservationPhotoBatch) => {
      const current = photoAttachmentsRef.current;
      const slots = MAX_PHOTOS_PER_FEATURE - current.photos.length;
      if (slots <= 0) return false;
      const photos = incoming.photos.slice(0, slots);
      setPhotos([...current.photos, ...photos]);
      setPhotoNames([
        ...current.photoNames,
        ...incoming.photoNames.slice(0, photos.length),
      ]);
      setPhotoBearings([
        ...current.photoBearings,
        ...incoming.photoBearings.slice(0, photos.length),
      ]);
      setAttachmentsDirty(true);
      setNotice(
        incoming.photos.length > slots
          ? t("fieldCollection.photoLimit", { max: MAX_PHOTOS_PER_FEATURE })
          : t("fieldCollection.photosAttached", { count: photos.length })
      );
      return true;
    });
    return () => setObservationPhotoSink(null);
  }, [editingFeatureId, open, pending, t]);

  const handleEditFeature = useCallback(
    (index: number) => {
      if (!activeLayer || !schema || !attachmentKeys || !activeLayer.geojson)
        return;
      const features = activeLayer.geojson.features;
      const feature = features[index];
      if (!feature) return;
      const editableVertices = featureVertices(feature, activeGeometry);
      if (!editableVertices) {
        setNotice(t("fieldCollection.editGeometryMismatch"));
        return;
      }
      const duplicateId =
        feature.id != null &&
        features.some(
          (candidate, i) => i !== index && candidate.id === feature.id
        );
      const featureId =
        feature.id == null || duplicateId ? newObservationId() : feature.id;

      clearPreview();
      photoSeqRef.current += 1;
      const occupiedKeys = schema.fields.map((field) => field.key);
      const attachments = readCollectionAttachments(
        feature.properties,
        occupiedKeys,
        attachmentKeys
      );
      setEditingFeatureId(featureId);
      setEditingFeatureIndex(index);
      editingVerticesRef.current = editableVertices;
      setPending(editableVertices);
      setObservationName(
        typeof feature.properties?.[OBSERVATION_NAME_PROPERTY] === "string"
          ? feature.properties[OBSERVATION_NAME_PROPERTY]
          : ""
      );
      setVertices(editableVertices);
      verticesRef.current = editableVertices;
      setValues(
        Object.fromEntries(
          schema.fields.map((field) => {
            const value = feature.properties?.[field.key];
            return [field.key, value == null ? "" : String(value)];
          })
        )
      );
      setNotes(attachments.notes.length > 0 ? attachments.notes : [""]);
      setPhotos(attachments.photos);
      setPhotoNames(attachments.photoNames);
      setPhotoBearings(attachments.photoBearings);
      setAttachmentsDirty(false);
      setReadingPhotos(false);
      setCollectingPhotoBearing(false);
      latestPhotoBearingRef.current = null;
      cameraBearingRef.current = null;
      cameraStartedAtRef.current = 0;
      setLastGpsFix(null);
      setErrors({});
      setNotice(null);
      if (activeGeometry === "point") {
        showMarker(editableVertices[0][0], editableVertices[0][1]);
      } else {
        const map = getMap();
        if (map) syncDrawPreview(map, activeGeometry, editableVertices);
      }
      focusAfterRender(
        "[data-field-collection-form] input:not([type='hidden']), [data-field-collection-form] select, [data-field-collection-form] textarea, [data-field-collection-attachments] textarea"
      );
    },
    [
      activeGeometry,
      activeLayer,
      attachmentKeys,
      clearPreview,
      getMap,
      schema,
      showMarker,
      t,
    ]
  );

  // The map click carries its exact layer/feature target. Consume that request
  // directly instead of relying on a separate selection render winning a race.
  useEffect(() => {
    openedSelectionRef.current = null;
  }, [openFeature]);
  useEffect(() => {
    if (!open || !openFeature || !activeLayer?.geojson) return;
    if (activeLayer.id !== openFeature.layerId) return;
    const selection = `${openFeature.layerId}\u0000${openFeature.featureId}`;
    if (openedSelectionRef.current === selection) return;
    const index = findCollectionFeatureIndex(
      activeLayer.geojson.features,
      openFeature.featureId
    );
    if (index < 0) return;
    openedSelectionRef.current = selection;
    handleEditFeature(index);
  }, [activeLayer, handleEditFeature, open, openFeature]);

  const handleCancelEdit = useCallback(() => {
    resetObservationDraft();
  }, [resetObservationDraft]);

  const handleDeleteFeature = useCallback(
    async (index: number) => {
      if (!activeLayer) return;
      const current = useAppStore
        .getState()
        .layers.find((layer) => layer.id === activeLayer.id);
      const feature = current?.geojson?.features[index];
      if (!current?.geojson || !feature) {
        setNotice(t("fieldCollection.observationGone"));
        return;
      }
      const name =
        typeof feature.properties?.[OBSERVATION_NAME_PROPERTY] === "string" &&
        feature.properties[OBSERVATION_NAME_PROPERTY].trim()
          ? feature.properties[OBSERVATION_NAME_PROPERTY].trim()
          : t("fieldCollection.observationNumber", { number: index + 1 });
      if (!window.confirm(t("fieldCollection.deleteConfirm", { name }))) return;
      const selected = useAppStore.getState().selectedFeatureId;
      const deletingSelected =
        selected != null &&
        findCollectionFeatureIndex(current.geojson.features, selected) === index;
      const patch = { geojson: removeFeature(current.geojson, index) };
      const nextLayers = useAppStore
        .getState()
        .layers.map((layer) =>
          layer.id === current.id ? { ...layer, ...patch } : layer
        );
      if (!(await persistProject(nextLayers))) {
        setNotice(t("fieldCollection.saveFailed"));
        return;
      }
      updateLayer(current.id, patch);
      if (deletingSelected) useAppStore.getState().selectFeature(null);
      setNotice(t("fieldCollection.deleted", { name }));
    },
    [activeLayer, persistProject, t, updateLayer]
  );

  const handleCreateLayer = useCallback(async () => {
    // Guard against a fast double-tap creating two identical layers before the
    // setLayerId re-render swaps the setup step out (reset in the layerId effect).
    if (creatingRef.current) return;
    creatingRef.current = true;
    const collectionSchema = buildSchema(
      drafts.map((d) => ({
        label: d.label,
        type: d.type,
        required: d.required,
        options: d.type === "choice" ? parseOptions(d.optionsText) : undefined,
      }))
    );
    const name = layerName.trim() || t("fieldCollection.layerNamePlaceholder");
    const id = addGeoJsonLayer(name, emptyFeatureCollection());
    const layer = useAppStore.getState().layers.find((item) => item.id === id);
    updateLayer(id, {
      metadata: {
        ...collectionMetadata(collectionSchema, geometry),
        ...(geometry === "point"
          ? {
              [HISTORY_POINT_MARKER_KEY]: true,
              [OBSERVATION_LABELS_KEY]: true,
            }
          : {}),
      },
      ...(geometry === "point" && layer
        ? {
            style: {
              ...layer.style,
              ...HISTORY_POINT_STYLE,
              labels: observationLabelStyle(layer.style.labels),
            },
          }
        : {}),
    });
    await persistProject();
    setLayerId(id);
    setNotice(null);
  }, [
    drafts,
    layerName,
    geometry,
    addGeoJsonLayer,
    persistProject,
    updateLayer,
    t,
  ]);

  const handlePointStyle = useCallback(
    (
      patch: Partial<
        Pick<GeoLibreLayer["style"], "markerShape" | "markerColor" | "markerSvg">
      >
    ) => {
      if (!activeLayer) return;
      updateLayer(activeLayer.id, { style: { ...activeLayer.style, ...patch } });
      void persistProject().then((saved) => {
        if (!saved) setNotice(t("fieldCollection.saveFailed"));
      });
    },
    [activeLayer, persistProject, t, updateLayer]
  );

  const commitObservation = useCallback(async (): Promise<boolean> => {
    if (!activeLayer || !schema || !attachmentKeys || !pending || readingPhotos)
      return false;
    // Fields hidden by a visibility expression never block a save, so the
    // schema's own required/type checks run against the visible subset only.
    const candidate = buildPropertiesWithForm(schema, values, attributeForm);
    const visibleSchema: CollectionSchema = {
      fields: schema.fields.filter((field) => {
        const config = getAttributeFormField(attributeForm, field.key);
        return !config || isAttributeFormFieldVisible(config, candidate);
      }),
    };
    const result = validateForm(visibleSchema, values);
    const formResult = validateAttributeFormValues(attributeForm, candidate);
    const mergedErrors: Record<string, string> = { ...result.errors };
    for (const [key, error] of Object.entries(formResult.errors)) {
      // Stored pre-localized; errorText surfaces unknown codes verbatim.
      if (!mergedErrors[key])
        mergedErrors[key] = attributeFormErrorMessage(t, error);
    }
    if (Object.keys(mergedErrors).length > 0) {
      setErrors(mergedErrors);
      const firstInvalidKey = schema.fields.find(
        (field) => mergedErrors[field.key]
      )?.key;
      if (firstInvalidKey) {
        requestAnimationFrame(() => {
          document.getElementById(`fc-${firstInvalidKey}`)?.focus();
        });
      }
      return false;
    }
    const fieldKeys = schema.fields.map((field) => field.key);
    const attachmentProperties =
      editingFeatureId != null && !attachmentsDirty
        ? {}
        : collectionAttachments(
            photos,
            notes,
            fieldKeys,
            attachmentKeys,
            photoBearings,
            photoNames
          );
    const current = useAppStore
      .getState()
      .layers.find((l) => l.id === activeLayer.id);
    if (!current) {
      // The collection layer was removed while the form was open — don't claim
      // a save that silently goes nowhere.
      setNotice(t("fieldCollection.layerGone"));
      return false;
    }
    const fc = current.geojson ?? emptyFeatureCollection();
    const observationNumber = (editingFeatureIndex ?? fc.features.length) + 1;
    const name =
      observationName.trim() ||
      t("fieldCollection.observationNumber", { number: observationNumber });
    const formProperties = buildPropertiesWithForm(
      schema,
      values,
      attributeForm,
      {
        ...attachmentProperties,
        [OBSERVATION_NAME_PROPERTY]: name,
      }
    );
    const metadata = {
      ...(current.metadata ?? {}),
      [COLLECTION_ATTACHMENT_KEYS_KEY]: attachmentKeys,
    };
    let patch: Partial<GeoLibreLayer>;
    let successNotice: string;
    let created = false;
    if (editingFeatureId != null && editingFeatureIndex != null) {
      const targetIndex = editingFeatureIndex;
      const source = fc.features[targetIndex];
      if (!source) {
        setNotice(t("fieldCollection.observationGone"));
        return false;
      }
      const preserved = attachmentsDirty
        ? withoutCollectionAttachments(
            source.properties,
            fieldKeys,
            attachmentKeys
          )
        : { ...(source.properties ?? {}) };
      for (const key of fieldKeys) delete preserved[key];
      delete preserved[OBSERVATION_NAME_PROPERTY];
      const replacement: Feature = {
        ...source,
        id: editingFeatureId,
        properties: { ...preserved, ...formProperties },
      };
      patch = {
        geojson: replaceFeature(fc, targetIndex, replacement),
        metadata,
      };
      successNotice = t("fieldCollection.updated", { layer: activeLayer.name });
    } else {
      const feature = {
        ...buildGeometryFeature(activeGeometry, pending, formProperties),
        id: newObservationId(),
      };
      // Read the tracking config off `current`, not the render-time layer: the
      // form can sit open across a configuration change.
      const tracked = editorTrackingFieldNames(current.editorTracking)
        ? stampFeatureEditorTracking(feature, "create", {
            config: current.editorTracking,
            userIdentity: currentEditorIdentity(),
          })
        : feature;
      patch = {
        geojson: appendFeature(fc, tracked),
        metadata,
      };
      created = true;
      successNotice = t(`fieldCollection.saved.${activeGeometry}`, {
        count: savedCountRef.current + 1,
        layer: activeLayer.name,
      });
    }
    const nextLayers = useAppStore
      .getState()
      .layers.map((layer) =>
        layer.id === current.id ? { ...layer, ...patch } : layer
      );
    if (!(await persistProject(nextLayers))) {
      setNotice(t("fieldCollection.saveFailed"));
      return false;
    }
    updateLayer(current.id, patch);
    if (created) savedCountRef.current += 1;
    setNotice(successNotice);
    return true;
  }, [
    activeLayer,
    schema,
    attachmentKeys,
    attributeForm,
    pending,
    observationName,
    values,
    notes,
    photos,
    photoNames,
    photoBearings,
    attachmentsDirty,
    readingPhotos,
    editingFeatureId,
    editingFeatureIndex,
    activeGeometry,
    persistProject,
    updateLayer,
    t,
  ]);

  const runCommit = useCallback(
    async (after: () => void) => {
      if (savingRef.current) return;
      savingRef.current = true;
      setSavingProject(true);
      try {
        if (await commitObservation()) after();
      } catch (error) {
        // commitObservation normally returns false on save failure; a thrown
        // error is a bug, but the user still needs to know why the project was
        // not saved instead of staring at an unresponsive dialog.
        console.error("Field observation save failed", error);
        setNotice(
          error instanceof Error
            ? error.message
            : t("fieldCollection.saveFailed"),
        );
      } finally {
        savingRef.current = false;
        setSavingProject(false);
      }
    },
    [commitObservation]
  );

  const handleSave = useCallback(() => {
    void runCommit(handleClose);
  }, [handleClose, runCommit]);

  const handleSaveAndContinue = useCallback(() => {
    void runCommit(() => {
      resetObservationDraft(false);
      focusAfterRender("[data-field-collection-location-actions] button");
    });
  }, [resetObservationDraft, runCommit]);

  const handleUpdate = useCallback(() => {
    void runCommit(() => {
      resetObservationDraft(false);
      focusAfterRender("[data-field-collection-observations] summary");
    });
  }, [resetObservationDraft, runCommit]);

  const setValue = useCallback((key: string, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
  }, []);

  const errorText = useCallback(
    (code: string | undefined): string | null => {
      if (!code) return null;
      if (code === "required") return t("fieldCollection.errorRequired");
      if (code === "number") return t("fieldCollection.errorNumber");
      if (code === "choice") return t("fieldCollection.errorChoice");
      // Surface any future validation code rather than hiding it silently.
      return code;
    },
    [t]
  );

  const inSetup = !activeLayer;

  // Quick-access control on the map: once a collection layer exists, surface a
  // floating button so users can reopen the tool without the Controls menu
  // during a collection session. Hidden while capturing (dialog reopens itself).
  const showQuickOpen =
    !open && !picking && !drawing && collectionLayers.length > 0;

  return (
    <>
      {showQuickOpen && (
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          aria-label={t("fieldCollection.reopen")}
          className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-1/2 z-40 flex min-h-11 -translate-x-1/2 items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm font-medium shadow-lg transition-colors hover:bg-accent"
        >
          <ClipboardList className="h-4 w-4 text-primary" />
          {t("fieldCollection.title")}
        </button>
      )}

      {drawing && (
        <DrawToolbar
          geometry={activeGeometry}
          count={vertices.length}
          minCount={minVertices(activeGeometry)}
          locating={locating}
          gpsFix={lastGpsFix}
          onAddGps={() => handleUseGps(true)}
          onUndo={handleUndoVertex}
          onFinish={() => finishDrawing(vertices)}
          onCancel={handleCancelDrawing}
        />
      )}

      {picking && <PickBanner onCancel={handleCancelPick} />}

      <Dialog
        open={open}
        onOpenChange={(nextOpen) =>
          nextOpen ? onOpenChange(true) : handleClose()
        }
      >
        <DialogContent
          className="field-collection-dialog h-[100dvh] max-h-none w-screen max-w-none rounded-none border-0 sm:h-auto sm:max-h-[calc(100dvh-1rem)] sm:w-[calc(100vw-1rem)] sm:max-w-md sm:rounded-lg sm:border"
          bodyClassName="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden p-0"
          closeLabel={t("common.close")}
        >
          <DialogHeader className="field-collection-header shrink-0 border-b p-4 pe-14">
            <DialogTitle>{t("fieldCollection.title")}</DialogTitle>
            <DialogDescription>
              {t(
                inSetup
                  ? "fieldCollection.description"
                  : editingFeatureId != null
                  ? "fieldCollection.editDescription"
                  : pending
                  ? "fieldCollection.captureReviewDescription"
                  : "fieldCollection.captureDescription"
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="field-collection-scroll">
            <div className="field-collection-scroll-content space-y-4 p-4 pe-6">
              <div className="space-y-1.5">
                <Label>{t("fieldCollection.targetLayer")}</Label>
                <Select
                  value={layerId}
                  onChange={(e) => {
                    setLayerId(e.target.value);
                    resetObservationDraft();
                    if (!e.target.value && drafts.length === 0) {
                      setDrafts([makeDraft()]);
                    }
                  }}
                >
                  {collectionLayers.map((l: GeoLibreLayer) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                  <option value="">{t("fieldCollection.newLayer")}</option>
                </Select>
              </div>

              {activeLayer && activeGeometry === "point" && !pending && (
                <div className="grid grid-cols-[1fr_auto] gap-3 rounded-md border p-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="fc-marker-shape">
                      {t("style.symbology.markerShape")}
                    </Label>
                    <Select
                      id="fc-marker-shape"
                      value={activeLayer.style.markerShape}
                      onChange={(event) =>
                        handlePointStyle({
                          markerShape: event.target.value as
                            | (typeof FIELD_MARKER_SHAPES)[number]
                            | "custom",
                        })
                      }
                    >
                      {FIELD_MARKER_SHAPES.map((shape) => (
                        <option key={shape} value={shape}>
                          {t(`style.symbology.markerShapes.${shape}`)}
                        </option>
                      ))}
                      <option value="custom">
                        {t("fieldCollection.markerIcons.selected")}
                      </option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="fc-marker-color">
                      {t("style.symbology.markerColor")}
                    </Label>
                    <Input
                      id="fc-marker-color"
                      type="color"
                      className="h-10 w-16 p-1"
                      value={activeLayer.style.markerColor}
                      onChange={(event) =>
                        handlePointStyle({ markerColor: event.target.value })
                      }
                    />
                  </div>
                  <div className="col-span-2 space-y-2">
                    <Label>{t("fieldCollection.markerIcons.label")}</Label>
                    <div
                      role="group"
                      aria-label={t("fieldCollection.markerIcons.label")}
                      className="grid grid-cols-3 gap-2"
                    >
                      {FIELD_MARKER_ICONS.map((icon) => {
                        const selected =
                          activeLayer.style.markerShape === "custom" &&
                          activeLayer.style.markerSvg === icon.svg;
                        return (
                          <button
                            key={icon.id}
                            type="button"
                            aria-pressed={selected}
                            className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-md border p-2 text-xs transition-colors hover:bg-accent ${
                              selected ? "border-primary bg-primary/10" : ""
                            }`}
                            onClick={() =>
                              handlePointStyle({
                                markerShape: "custom",
                                markerSvg: icon.svg,
                              })
                            }
                          >
                            <img
                              src={
                                resolveSvgSource(
                                  icon.svg.replaceAll(
                                    "param(fill)",
                                    activeLayer.style.markerColor
                                  )
                                ) ?? undefined
                              }
                              alt=""
                              aria-hidden="true"
                              className="h-8 w-8"
                            />
                            <span>{t(icon.labelKey)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {activeLayer &&
                !pending &&
                (activeLayer.geojson?.features.length ?? 0) > 0 && (
                  <ObservationList
                    features={activeLayer.geojson!.features}
                    geometry={activeGeometry}
                    onEdit={handleEditFeature}
                    onDelete={handleDeleteFeature}
                  />
                )}

              {inSetup ? (
                <SetupStep
                  layerName={layerName}
                  onLayerName={setLayerName}
                  geometry={geometry}
                  onGeometry={setGeometry}
                  drafts={drafts}
                  onDrafts={setDrafts}
                  newDraft={makeDraft}
                  onCreate={handleCreateLayer}
                />
              ) : (
                <CaptureStep
                  geometry={activeGeometry}
                  schema={schema!}
                  attributeForm={attributeForm}
                  pending={pending}
                  editing={editingFeatureId != null}
                  observationName={observationName}
                  onObservationName={setObservationName}
                  values={values}
                  setValue={setValue}
                  errors={errors}
                  errorText={errorText}
                  notes={notes}
                  onNotesChange={(nextNotes) => {
                    setAttachmentsDirty(true);
                    setNotes(nextNotes);
                  }}
                  photos={photos}
                  photoNames={photoNames}
                  photoBearings={photoBearings}
                  readingPhotos={readingPhotos}
                  onPrepareCamera={handlePrepareCamera}
                  onCameraCancel={handleCameraCancel}
                  onPhotos={handlePhotos}
                  onNativePhotos={handleNativePhotos}
                  onRemovePhoto={(index) => {
                    setAttachmentsDirty(true);
                    setPhotos((current) =>
                      current.filter((_, i) => i !== index)
                    );
                    setPhotoNames((current) =>
                      current.filter((_, i) => i !== index)
                    );
                    setPhotoBearings((current) =>
                      current.filter((_, i) => i !== index)
                    );
                  }}
                  locating={locating}
                  gpsFix={lastGpsFix}
                  onUseGps={() => handleUseGps(false)}
                  onPickOnMap={handlePickOnMap}
                  onStartDrawing={handleStartDrawing}
                />
              )}

              {notice && (
                <p
                  aria-live="polite"
                  className="rounded-md bg-muted p-2 text-sm text-muted-foreground"
                >
                  {notice}
                </p>
              )}
            </div>
          </div>

          <div className="field-collection-footer flex shrink-0 flex-wrap justify-end gap-2 border-t p-3">
            {editingFeatureId != null ? (
              <>
                <Button
                  className="min-h-11"
                  variant="outline"
                  onClick={handleCancelEdit}
                  disabled={readingPhotos || savingProject}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  className="min-h-11"
                  onClick={handleUpdate}
                  disabled={readingPhotos || savingProject || !pending}
                >
                  <Save className="me-2 h-4 w-4" />
                  {t("fieldCollection.updateObservation")}
                </Button>
              </>
            ) : activeLayer && pending ? (
              <>
                <Button
                  className="min-h-11"
                  variant="outline"
                  onClick={handleSave}
                  disabled={readingPhotos || savingProject}
                >
                  <Save className="me-2 h-4 w-4" />
                  {t("fieldCollection.saveObservation")}
                </Button>
                <Button
                  className="min-h-11"
                  onClick={handleSaveAndContinue}
                  disabled={readingPhotos || savingProject}
                >
                  <Plus className="me-2 h-4 w-4" />
                  {t("fieldCollection.saveAndContinue")}
                </Button>
              </>
            ) : (
              <Button
                className="min-h-11"
                variant="outline"
                onClick={handleClose}
              >
                {t("common.close")}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface ObservationListProps {
  features: Feature[];
  geometry: GeometryType;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
}

function ObservationList({
  features,
  geometry,
  onEdit,
  onDelete,
}: ObservationListProps) {
  const { t } = useTranslation();
  return (
    <details
      className="rounded-md border p-2"
      data-field-collection-observations
    >
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">
        {t("fieldCollection.savedObservations", { count: features.length })}
      </summary>
      <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
        {features.map((feature, index) => {
          const vertices = featureVertices(feature, geometry);
          const position =
            geometry === "point" && vertices
              ? formatLatLng(vertices[0][0], vertices[0][1])
              : vertices
              ? t("fieldCollection.vertices", { count: vertices.length })
              : t("gps.notAvailable");
          const storedName = feature.properties?.[OBSERVATION_NAME_PROPERTY];
          const name =
            typeof storedName === "string" && storedName.trim()
              ? storedName.trim()
              : t("fieldCollection.observationNumber", { number: index + 1 });
          return (
            <div
              key={feature.id ?? index}
              className="flex items-center justify-between gap-2 rounded-md bg-muted px-2 py-1.5"
            >
              <MapPin className="h-4 w-4 shrink-0 text-amber-500" />
              <div className="min-w-0 flex-1 text-sm">
                <div className="truncate font-medium">{name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {position}
                </div>
              </div>
              <div className="flex shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="min-h-11 min-w-11"
                  aria-label={t("fieldCollection.editObservationNumber", {
                    number: index + 1,
                  })}
                  onClick={() => onEdit(index)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="min-h-11 min-w-11 text-destructive"
                  aria-label={t("fieldCollection.deleteObservationNumber", {
                    number: index + 1,
                  })}
                  onClick={() => onDelete(index)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}

interface DrawToolbarProps {
  geometry: GeometryType;
  count: number;
  minCount: number;
  locating: boolean;
  gpsFix: GpsFix | null;
  onAddGps: () => void;
  onUndo: () => void;
  onFinish: () => void;
  onCancel: () => void;
}

/** Floating control shown while drawing a line/polygon (dialog hidden). */
function DrawToolbar({
  geometry,
  count,
  minCount,
  locating,
  gpsFix,
  onAddGps,
  onUndo,
  onFinish,
  onCancel,
}: DrawToolbarProps) {
  const { t } = useTranslation();
  const ready = count >= minCount;
  return (
    <div className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-1/2 z-50 flex max-w-[95vw] -translate-x-1/2 flex-col gap-2 rounded-lg border bg-card p-3 shadow-xl">
      <div className="flex items-center gap-2 text-sm">
        <Pencil className="h-4 w-4 text-primary" />
        <span className="font-medium">
          {t(`fieldCollection.geom.${geometry}`)}
        </span>
        <span className="text-muted-foreground">
          {ready
            ? t("fieldCollection.vertices", { count })
            : t("fieldCollection.needMore", { min: minCount })}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("fieldCollection.dblClickHint")}
      </p>
      {gpsFix && <GpsMetadataReadout fix={gpsFix} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="min-h-11"
          variant="outline"
          size="sm"
          onClick={onAddGps}
          disabled={locating}
        >
          {locating ? (
            <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Navigation className="me-1 h-3.5 w-3.5" />
          )}
          {t("fieldCollection.addGpsVertex")}
        </Button>
        <Button
          className="min-h-11"
          variant="outline"
          size="sm"
          onClick={onUndo}
          disabled={count === 0}
        >
          <Undo2 className="me-1 h-3.5 w-3.5" />
          {t("fieldCollection.undo")}
        </Button>
        <Button
          className="min-h-11"
          size="sm"
          onClick={onFinish}
          disabled={!ready}
        >
          <Check className="me-1 h-3.5 w-3.5" />
          {t("fieldCollection.finish")}
        </Button>
        <Button
          className="min-h-11"
          variant="ghost"
          size="sm"
          onClick={onCancel}
        >
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Floating banner shown while waiting for a point pick (the dialog is hidden so
 * the map is clear). Without it the only cue is the crosshair cursor, leaving
 * the app looking like ordinary navigation mode (#711).
 */
function PickBanner({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  // Instance-scoped so the aria-describedby link holds even if more than one
  // banner is ever mounted at once (#720 review).
  const hintId = useId();
  return (
    <div className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-1/2 z-50 flex max-w-[95vw] -translate-x-1/2 flex-col gap-2 rounded-lg border bg-card p-3 shadow-xl">
      {/* Only the non-interactive status text is the live region, with the
          Cancel button as a sibling, so screen readers don't re-read the button
          on region mutations (ARIA APG). The button also takes focus on mount
          (the dialog that held focus just closed) and is described by the hint,
          so the placement instructions reach keyboard/SR users reliably even
          where a region injected on mount is missed (#720 review). */}
      <div role="status" className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm">
          <Crosshair className="h-4 w-4 text-primary" />
          <span className="font-medium">
            {t("fieldCollection.pickBannerTitle")}
          </span>
        </div>
        <p id={hintId} className="text-xs text-muted-foreground">
          {t("fieldCollection.pickBannerHint")}
        </p>
      </div>
      <div className="flex justify-end">
        <Button
          className="min-h-11"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          autoFocus
          aria-describedby={hintId}
        >
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

interface SetupStepProps {
  layerName: string;
  onLayerName: (v: string) => void;
  geometry: GeometryType;
  onGeometry: (g: GeometryType) => void;
  drafts: DraftField[];
  onDrafts: (next: DraftField[]) => void;
  newDraft: () => DraftField;
  onCreate: () => void;
}

function SetupStep({
  layerName,
  onLayerName,
  geometry,
  onGeometry,
  drafts,
  onDrafts,
  newDraft,
  onCreate,
}: SetupStepProps) {
  const { t } = useTranslation();
  const update = (id: number, patch: Partial<DraftField>) =>
    onDrafts(drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="fc-layer-name">{t("fieldCollection.layerName")}</Label>
        <Input
          id="fc-layer-name"
          value={layerName}
          placeholder={t("fieldCollection.layerNamePlaceholder")}
          onChange={(e) => onLayerName(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="fc-geometry">{t("fieldCollection.geometry")}</Label>
        <Select
          id="fc-geometry"
          value={geometry}
          onChange={(e) => onGeometry(e.target.value as GeometryType)}
        >
          {GEOMETRY_TYPES.map((g) => (
            <option key={g} value={g}>
              {t(`fieldCollection.geom.${g}`)}
            </option>
          ))}
        </Select>
      </div>

      <Separator />

      <div className="flex items-center justify-between">
        <Label>{t("fieldCollection.fields")}</Label>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDrafts([...drafts, newDraft()])}
        >
          <Plus className="me-1 h-3.5 w-3.5" />
          {t("fieldCollection.addField")}
        </Button>
      </div>

      {drafts.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("fieldCollection.noFields")}
        </p>
      )}

      <div className="space-y-3">
        {drafts.map((d) => (
          <div key={d.id} className="space-y-2 rounded-md border p-2">
            <div className="flex items-center gap-2">
              <Input
                aria-label={t("fieldCollection.fieldLabel")}
                value={d.label}
                placeholder={t("fieldCollection.fieldLabel")}
                onChange={(e) => update(d.id, { label: e.target.value })}
              />
              <Select
                aria-label={t("fieldCollection.fieldType")}
                className="w-28 shrink-0"
                value={d.type}
                onChange={(e) =>
                  update(d.id, { type: e.target.value as FieldType })
                }
              >
                {FIELD_TYPES.map((ft) => (
                  <option key={ft} value={ft}>
                    {t(`fieldCollection.type.${ft}`)}
                  </option>
                ))}
              </Select>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("common.remove")}
                onClick={() => onDrafts(drafts.filter((x) => x.id !== d.id))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {d.type === "choice" && (
              <Input
                aria-label={t("fieldCollection.options")}
                value={d.optionsText}
                placeholder={t("fieldCollection.options")}
                onChange={(e) => update(d.id, { optionsText: e.target.value })}
              />
            )}
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={d.required}
                onChange={(e) => update(d.id, { required: e.target.checked })}
              />
              {t("fieldCollection.required")}
            </label>
          </div>
        ))}
      </div>

      <Button className="w-full" onClick={onCreate}>
        <MapPin className="me-2 h-4 w-4" />
        {t("fieldCollection.createLayer")}
      </Button>
    </div>
  );
}

interface CaptureStepProps {
  geometry: GeometryType;
  schema: CollectionSchema;
  /** Attribute Form designer config narrowed to this schema's fields. */
  attributeForm?: AttributeFormConfig;
  pending: Vertex[] | null;
  editing: boolean;
  observationName: string;
  onObservationName: (name: string) => void;
  values: Record<string, string>;
  setValue: (key: string, value: string) => void;
  errors: Record<string, string>;
  errorText: (code: string | undefined) => string | null;
  notes: string[];
  onNotesChange: (notes: string[]) => void;
  photos: string[];
  photoNames: string[];
  photoBearings: (number | null)[];
  readingPhotos: boolean;
  onPrepareCamera: () => boolean;
  onCameraCancel: () => void;
  onPhotos: (
    e: React.ChangeEvent<HTMLInputElement>,
    source: "camera" | "gallery"
  ) => void;
  onNativePhotos: (source: "camera" | "gallery") => void;
  onRemovePhoto: (index: number) => void;
  locating: boolean;
  gpsFix: GpsFix | null;
  onUseGps: () => void;
  onPickOnMap: () => void;
  onStartDrawing: () => void;
}

function CaptureStep({
  geometry,
  schema,
  attributeForm,
  pending,
  editing,
  observationName,
  onObservationName,
  values,
  setValue,
  errors,
  errorText,
  notes,
  onNotesChange,
  photos,
  photoNames,
  photoBearings,
  readingPhotos,
  onPrepareCamera,
  onCameraCancel,
  onPhotos,
  onNativePhotos,
  onRemovePhoto,
  locating,
  gpsFix,
  onUseGps,
  onPickOnMap,
  onStartDrawing,
}: CaptureStepProps) {
  const { t } = useTranslation();
  const isPoint = geometry === "point";
  // Separate hidden inputs make camera capture and image-library selection
  // explicit on mobile instead of relying on browser-specific chooser wording.
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [resolvedPhotos, setResolvedPhotos] = useState<string[]>([]);
  useEffect(() => {
    let current = true;
    void Promise.all(photos.map(resolvePhotoSource)).then((sources) => {
      if (current) setResolvedPhotos(sources);
    });
    return () => {
      current = false;
    };
  }, [photos]);

  const handleOpenPhoto = (index: number) => {
    const photo = photos[index];
    if (!nativeFieldMediaAvailable() || !photo.startsWith("content://")) {
      setPreviewIndex(index);
      return;
    }
    void openNativePhoto(photo).catch((error) => {
      console.error("Could not open Field Survey photo", error);
      setPreviewIndex(index);
    });
  };

  useEffect(() => {
    const input = cameraInputRef.current;
    if (!input) return;
    input.addEventListener("cancel", onCameraCancel);
    return () => input.removeEventListener("cancel", onCameraCancel);
  }, [onCameraCancel, pending]);

  useEffect(() => {
    if (!editing) return;
    const target = document.querySelector<HTMLElement>(
      "[data-field-collection-form] input:not([type='hidden']), [data-field-collection-form] select, [data-field-collection-form] textarea, [data-field-collection-attachments] textarea"
    );
    target?.focus();
  }, [editing]);

  // Candidate properties for visibility expressions, computed once per render
  // instead of per field (visibility updates live as the user types).
  const candidateProps = useMemo(
    () =>
      attributeForm
        ? buildPropertiesWithForm(schema, values, attributeForm)
        : null,
    [schema, values, attributeForm]
  );

  const hasLegacyOverflow =
    photos.length > MAX_PHOTOS_PER_FEATURE ||
    notes.length > MAX_NOTES_PER_FEATURE ||
    notes.some((note) => note.length > MAX_NOTE_LENGTH);

  return (
    <div className="space-y-4">
      <section
        className="space-y-3"
        aria-labelledby="fc-location-heading"
      >
        <h3 id="fc-location-heading" className="text-sm font-semibold">
          {t("fieldCollection.step.location")}
        </h3>
        {isPoint ? (
            pending ? (
              // A point is already captured, so GPS would silently discard the
              // current selection; offer only an explicit reposition (#711).
              <Button
                variant="outline"
                className="min-h-11 w-full"
                onClick={onPickOnMap}
              >
                <Crosshair className="me-2 h-4 w-4" />
                {t("fieldCollection.reposition")}
              </Button>
            ) : (
              <div
                className="grid grid-cols-2 gap-2"
                data-field-collection-location-actions
              >
                <Button
                  className="min-h-11"
                  variant="outline"
                  onClick={onUseGps}
                  disabled={locating}
                >
                  {locating ? (
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Navigation className="me-2 h-4 w-4" />
                  )}
                  {locating
                    ? t("fieldCollection.locating")
                    : t("fieldCollection.useGps")}
                </Button>
                <Button
                  className="min-h-11"
                  variant="outline"
                  onClick={onPickOnMap}
                >
                  <Crosshair className="me-2 h-4 w-4" />
                  {t("fieldCollection.pickOnMap")}
                </Button>
              </div>
            )
          ) : (
            <Button
              variant="outline"
              className="min-h-11 w-full"
              onClick={onStartDrawing}
            >
              <Pencil className="me-2 h-4 w-4" />
              {t("fieldCollection.drawOnMap")}
            </Button>
          )}

        {gpsFix && <GpsMetadataReadout fix={gpsFix} />}

        {!pending ? (
          <p className="text-sm text-muted-foreground">
            {isPoint
              ? t("fieldCollection.captureHint")
              : t("fieldCollection.drawHint")}
          </p>
        ) : (
          <div className="flex items-center gap-2 rounded-md bg-muted p-2 text-sm">
            <MapPin className="h-4 w-4 shrink-0 text-primary" />
            <span className="tabular-nums">
              {isPoint
                ? formatLatLng(pending[0][0], pending[0][1])
                : t("fieldCollection.vertices", { count: pending.length })}
            </span>
          </div>
        )}
      </section>

      {pending && (
        <>
          <section
            className="space-y-3"
            aria-labelledby="fc-form-heading"
            data-field-collection-form
          >
            <h3 id="fc-form-heading" className="text-sm font-semibold">
              {t("fieldCollection.step.form")}
            </h3>
            <div className="space-y-1.5">
              <Label htmlFor="fc-observation-name">
                {t("fieldCollection.observationName")}
              </Label>
              <Input
                id="fc-observation-name"
                value={observationName}
                placeholder={t("fieldCollection.observationNamePlaceholder")}
                onChange={(event) => onObservationName(event.target.value)}
              />
            </div>
            {schema.fields.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t("fieldCollection.noCaptureFields")}
              </p>
            )}
            {schema.fields.map((field) => {
              const config = getAttributeFormField(attributeForm, field.key);
              // Conditional visibility: a hidden field disappears from the form
              // (and its validation is skipped by handleSave). Evaluated against
              // the current candidate values so it updates as the user types.
              if (
                config &&
                candidateProps &&
                !isAttributeFormFieldVisible(config, candidateProps)
              ) {
                return null;
              }
              const err = errorText(errors[field.key]);
              const errorId = `fc-${field.key}-error`;
              const accessibility = {
                "aria-invalid": err ? (true as const) : undefined,
                "aria-describedby": err ? errorId : undefined,
              };
              return (
                <div key={field.key} className="space-y-1.5">
                  <Label htmlFor={`fc-${field.key}`}>
                    {config?.alias?.trim() || field.label}
                    {(field.required || config?.required) && (
                      <span className="ms-0.5 text-destructive">*</span>
                    )}
                  </Label>
                  {config?.widget === "valueMap" && config.valueMap?.length ? (
                    <Select
                      id={`fc-${field.key}`}
                      {...accessibility}
                      value={values[field.key] ?? ""}
                      onChange={(e) => setValue(field.key, e.target.value)}
                    >
                      <option value="">—</option>
                      {config.valueMap.map((entry) => (
                        <option key={entry.value} value={entry.value}>
                          {entry.label ?? entry.value}
                        </option>
                      ))}
                    </Select>
                  ) : config?.widget === "checkbox" ? (
                    <div className="flex h-9 items-center">
                      <input
                        id={`fc-${field.key}`}
                        {...accessibility}
                        type="checkbox"
                        className="h-4 w-4"
                        checked={values[field.key] === "true"}
                        onChange={(e) =>
                          setValue(
                            field.key,
                            e.target.checked ? "true" : "false"
                          )
                        }
                      />
                    </div>
                  ) : config ? (
                    <Input
                      id={`fc-${field.key}`}
                      type={
                        config.widget === "number" || config.widget === "range"
                          ? "number"
                          : config.widget === "date"
                          ? "date"
                          : "text"
                      }
                      min={config.min}
                      max={config.max}
                      step={config.step}
                      {...accessibility}
                      value={values[field.key] ?? ""}
                      onChange={(e) => setValue(field.key, e.target.value)}
                    />
                  ) : field.type === "choice" && field.options?.length ? (
                    <Select
                      id={`fc-${field.key}`}
                      {...accessibility}
                      value={values[field.key] ?? ""}
                      onChange={(e) => setValue(field.key, e.target.value)}
                    >
                      <option value="">—</option>
                      {field.options.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      id={`fc-${field.key}`}
                      {...accessibility}
                      type={
                        field.type === "number"
                          ? "number"
                          : field.type === "date"
                          ? "date"
                          : "text"
                      }
                      value={values[field.key] ?? ""}
                      onChange={(e) => setValue(field.key, e.target.value)}
                    />
                  )}
                  {err && (
                    <p
                      id={errorId}
                      role="alert"
                      className="text-xs text-destructive"
                    >
                      {err}
                    </p>
                  )}
                </div>
              );
            })}
          </section>

          <section
            className="space-y-3"
            aria-labelledby="fc-attachments-heading"
            data-field-collection-attachments
          >
            <h3 id="fc-attachments-heading" className="text-sm font-semibold">
              {t("fieldCollection.step.attachments")}
            </h3>
            {hasLegacyOverflow && (
              <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200">
                {t("fieldCollection.legacyOverflow")}
              </p>
            )}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t("fieldCollection.notes")}</Label>
                {notes.length < MAX_NOTES_PER_FEATURE && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-11"
                    onClick={() => onNotesChange([...notes, ""])}
                  >
                    <Plus className="me-1 h-3.5 w-3.5" />
                    {t("fieldCollection.addNote")}
                  </Button>
                )}
              </div>
              {notes.map((note, index) => (
                <div key={index} className="flex items-start gap-2">
                  <Textarea
                    rows={2}
                    maxLength={
                      note.length > MAX_NOTE_LENGTH
                        ? undefined
                        : MAX_NOTE_LENGTH
                    }
                    aria-label={t("fieldCollection.noteNumber", {
                      number: index + 1,
                    })}
                    value={note}
                    onChange={(e) =>
                      onNotesChange(
                        notes.map((value, i) =>
                          i === index ? e.target.value : value
                        )
                      )
                    }
                  />
                  {notes.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="min-h-11 min-w-11"
                      aria-label={t("fieldCollection.removeNote", {
                        number: index + 1,
                      })}
                      onClick={() =>
                        onNotesChange(notes.filter((_, i) => i !== index))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="fc-photo">
                {t("fieldCollection.photosOptional")}
              </Label>
              {photos.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {photos.map((_, index) => (
                    <div key={index} className="relative">
                      <button
                        type="button"
                        className="block w-full rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={t("fieldCollection.openPhoto", {
                          number: index + 1,
                        })}
                        onClick={() => handleOpenPhoto(index)}
                      >
                        <img
                          src={resolvedPhotos[index] || undefined}
                          title={photoNames[index] || undefined}
                          alt={t("fieldCollection.photoNumber", {
                            number: index + 1,
                          })}
                          className="aspect-[4/3] w-full rounded-md bg-muted object-contain"
                        />
                      </button>
                      {photoBearings[index] != null && (
                        <span className="pointer-events-none absolute bottom-1 start-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
                          {t("fieldCollection.photoBearing", {
                            value: formatPhotoBearing(photoBearings[index]!),
                          })}
                        </span>
                      )}
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        className="absolute end-1 top-1 min-h-11 min-w-11"
                        disabled={readingPhotos}
                        aria-label={t("fieldCollection.removePhotoNumber", {
                          number: index + 1,
                        })}
                        onClick={() => onRemovePhoto(index)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <input
                ref={cameraInputRef}
                id="fc-camera"
                type="file"
                accept="image/*"
                capture="environment"
                disabled={readingPhotos}
                className="hidden"
                onChange={(event) => onPhotos(event, "camera")}
              />
              <input
                ref={galleryInputRef}
                id="fc-photo"
                type="file"
                accept="image/*"
                multiple
                disabled={readingPhotos}
                className="hidden"
                onChange={(event) => onPhotos(event, "gallery")}
              />
              {photos.length < MAX_PHOTOS_PER_FEATURE && (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={readingPhotos}
                    onClick={() => {
                      if (nativeFieldMediaAvailable()) onNativePhotos("camera");
                      else if (onPrepareCamera()) cameraInputRef.current?.click();
                    }}
                  >
                    <Camera className="me-2 h-4 w-4" />
                    {t("fieldCollection.takePhoto")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={readingPhotos}
                    onClick={() =>
                      nativeFieldMediaAvailable()
                        ? onNativePhotos("gallery")
                        : galleryInputRef.current?.click()
                    }
                  >
                    <ImagePlus className="me-2 h-4 w-4" />
                    {t("fieldCollection.addPhotos")}
                  </Button>
                </div>
              )}
            </div>
          </section>

          {previewIndex != null && resolvedPhotos[previewIndex] && (
            <PhotoLightbox
              photos={resolvedPhotos}
              photoNames={photoNames}
              photoBearings={photoBearings}
              index={previewIndex}
              onIndex={setPreviewIndex}
              onClose={() => setPreviewIndex(null)}
              onRemove={(index) => {
                onRemovePhoto(index);
                if (photos.length === 1) setPreviewIndex(null);
                else setPreviewIndex(Math.min(index, photos.length - 2));
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

interface PhotoLightboxProps {
  photos: string[];
  photoNames: string[];
  photoBearings: (number | null)[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  onRemove: (index: number) => void;
}

function PhotoLightbox({
  photos,
  photoNames,
  photoBearings,
  index,
  onIndex,
  onClose,
  onRemove,
}: PhotoLightboxProps) {
  const { t } = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const previous = () => onIndex((index - 1 + photos.length) % photos.length);
  const next = () => onIndex((index + 1) % photos.length);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft") {
        onIndex((index - 1 + photos.length) % photos.length);
      } else if (event.key === "ArrowRight") {
        onIndex((index + 1) % photos.length);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [index, onClose, onIndex, photos.length]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="h-[100dvh] max-h-none w-screen max-w-none rounded-none border-0 bg-black p-0 [&>button]:hidden"
        bodyClassName="relative flex items-center justify-center overflow-hidden p-0"
        closeLabel={t("common.close")}
      >
        <DialogTitle className="sr-only">
          {t("fieldCollection.photoViewer")}
        </DialogTitle>
        <img
          src={photos[index]}
          alt={t("fieldCollection.photoNumber", { number: index + 1 })}
          className="h-full w-full select-none object-contain"
          draggable={false}
        />
        <div className="absolute end-[max(4.5rem,env(safe-area-inset-right))] start-[max(0.75rem,env(safe-area-inset-left))] top-[max(0.75rem,env(safe-area-inset-top))] truncate rounded-full bg-black/60 px-3 py-1 text-sm text-white">
          {photoNames[index] || `${index + 1} / ${photos.length}`}
          {photoBearings[index] != null && (
            <>
              {" "}
              ·{" "}
              {t("fieldCollection.photoBearing", {
                value: formatPhotoBearing(photoBearings[index]!),
              })}
            </>
          )}
        </div>
        <Button
          ref={closeRef}
          type="button"
          variant="secondary"
          size="icon"
          className="absolute end-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] min-h-11 min-w-11 rounded-full"
          aria-label={t("common.close")}
          onClick={onClose}
        >
          <X className="h-5 w-5" />
        </Button>
        {photos.length > 1 && (
          <>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="absolute start-[max(0.75rem,env(safe-area-inset-left))] top-1/2 min-h-11 min-w-11 rounded-full"
              aria-label={t("fieldCollection.previousPhoto")}
              onClick={previous}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="absolute end-[max(0.75rem,env(safe-area-inset-right))] top-1/2 min-h-11 min-w-11 rounded-full"
              aria-label={t("fieldCollection.nextPhoto")}
              onClick={next}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </>
        )}
        <Button
          type="button"
          variant="destructive"
          className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] min-h-11"
          onClick={() => onRemove(index)}
        >
          <Trash2 className="me-2 h-4 w-4" />
          {t("fieldCollection.deletePhoto")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function GpsMetadataReadout({ fix }: { fix: GpsFix }) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-muted px-3 py-2 text-sm tabular-nums text-muted-foreground"
    >
      <span>±{formatAccuracy(fix.accuracy, t("gps.notAvailable"))}</span>
      <span>
        {t("gps.satellitesValue", {
          value: fix.satellites ?? t("gps.notAvailable"),
        })}
      </span>
    </div>
  );
}
