import type { GeoLibreAppAPI, GeoLibrePlugin } from "../types";
import { FIELD_SURVEY_PLUGIN_ID } from "../plugin-ids";

export { FIELD_SURVEY_PLUGIN_ID } from "../plugin-ids";

export const FIELD_SURVEY_OPEN_COLLECTION_EVENT = "geolibre:field-survey:open-collection";
export const FIELD_SURVEY_OPEN_GPS_EVENT = "geolibre:field-survey:open-gps";
export const FIELD_SURVEY_OPEN_PHOTOS_EVENT = "geolibre:field-survey:open-photos";
export const FIELD_SURVEY_OPEN_BASEMAPS_EVENT = "geolibre:field-survey:open-basemaps";
export const FIELD_SURVEY_NEW_PROJECT_EVENT = "geolibre:field-survey:new-project";

export const FIELD_SURVEY_MENU_ICON =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="5" y="4" width="14" height="17" rx="2" />' +
      '<path d="M9 4v3h6V4" />' +
      '<circle cx="12" cy="12" r="2.5" />' +
      '<path d="M12 14.5v4" />' +
      '<path d="M10 18.5h4" />' +
    "</svg>",
  );

export interface FieldSurveyLabels {
  menu: string;
  fieldCollection: string;
  gpsTracking: string;
  insertPhotos: string;
  basemaps: string;
  newProject: string;
}

let labels: FieldSurveyLabels = {
  menu: "Field Survey",
  fieldCollection: "Field Collection",
  gpsTracking: "GPS Tracking",
  insertPhotos: "Insert Photos",
  basemaps: "Basemaps",
  newProject: "New Project",
};
let app: GeoLibreAppAPI | null = null;
let unregister: (() => void) | undefined;

function dispatch(eventName: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(eventName));
}

function registerMenu(): void {
  unregister?.();
  unregister = app?.registerToolbarMenu?.({
    id: `${FIELD_SURVEY_PLUGIN_ID}-menu`,
    label: labels.menu,
    icon: FIELD_SURVEY_MENU_ICON,
    mobileVisible: true,
    items: [
      {
        id: "field-collection",
        label: labels.fieldCollection,
        onSelect: () => dispatch(FIELD_SURVEY_OPEN_COLLECTION_EVENT),
      },
      {
        id: "gps-tracking",
        label: labels.gpsTracking,
        onSelect: () => dispatch(FIELD_SURVEY_OPEN_GPS_EVENT),
      },
      {
        id: "insert-photos",
        label: labels.insertPhotos,
        onSelect: () => dispatch(FIELD_SURVEY_OPEN_PHOTOS_EVENT),
      },
      {
        id: "basemaps",
        label: labels.basemaps,
        onSelect: () => dispatch(FIELD_SURVEY_OPEN_BASEMAPS_EVENT),
      },
      { type: "separator", id: "project" },
      {
        id: "new-project",
        label: labels.newProject,
        onSelect: () => dispatch(FIELD_SURVEY_NEW_PROJECT_EVENT),
      },
    ],
  });
}

export function setFieldSurveyLabels(next: Partial<FieldSurveyLabels>): void {
  labels = { ...labels, ...next };
  if (app) registerMenu();
}

export const fieldSurveyPlugin: GeoLibrePlugin = {
  id: FIELD_SURVEY_PLUGIN_ID,
  name: "Field Survey",
  version: "1.0.0",
  activate(nextApp) {
    app = nextApp;
    registerMenu();
  },
  deactivate() {
    unregister?.();
    unregister = undefined;
    app = null;
  },
};
