import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  FIELD_SURVEY_NEW_PROJECT_EVENT,
  FIELD_SURVEY_OPEN_COLLECTION_EVENT,
  FIELD_SURVEY_OPEN_GPS_EVENT,
  FIELD_SURVEY_OPEN_PHOTOS_EVENT,
  FIELD_SURVEY_OPEN_BASEMAPS_EVENT,
  FIELD_SURVEY_PLUGIN_ID,
  fieldSurveyPlugin,
  setFieldSurveyLabels,
} from "../packages/plugins/src/plugins/field-survey";
import type { GeoLibreAppAPI, GeoLibreToolbarMenu } from "../packages/plugins/src/types";

const runtime = globalThis as typeof globalThis & { window?: EventTarget };

function app(menus: GeoLibreToolbarMenu[], unregistered: () => void): GeoLibreAppAPI {
  return {
    registerToolbarMenu: (menu) => {
      menus.push(menu);
      return unregistered;
    },
  };
}

afterEach(() => {
  fieldSurveyPlugin.deactivate({} as GeoLibreAppAPI);
  delete runtime.window;
  setFieldSurveyLabels({
    menu: "Field Survey",
    fieldCollection: "Field Collection",
    gpsTracking: "GPS Tracking",
    insertPhotos: "Insert Photos",
    basemaps: "Basemaps",
    newProject: "New Project",
  });
});

describe("fieldSurveyPlugin", () => {
  it("registers actions, dispatches namespaced events, and unregisters", () => {
    const menus: GeoLibreToolbarMenu[] = [];
    let unregistered = 0;
    runtime.window = new EventTarget();
    const events: string[] = [];
    for (const event of [
      FIELD_SURVEY_OPEN_COLLECTION_EVENT,
      FIELD_SURVEY_OPEN_GPS_EVENT,
      FIELD_SURVEY_OPEN_PHOTOS_EVENT,
      FIELD_SURVEY_OPEN_BASEMAPS_EVENT,
      FIELD_SURVEY_NEW_PROJECT_EVENT,
    ]) {
      runtime.window.addEventListener(event, () => events.push(event));
    }

    fieldSurveyPlugin.activate(app(menus, () => unregistered++));
    assert.equal(fieldSurveyPlugin.id, FIELD_SURVEY_PLUGIN_ID);
    assert.equal(menus[0].mobileVisible, true);
    assert.deepEqual(
      menus[0].items.filter((item) => item.type !== "separator").map((item) => item.id),
      ["field-collection", "gps-tracking", "insert-photos", "basemaps", "new-project"],
    );
    for (const item of menus[0].items) {
      if (item.type !== "separator") item.onSelect();
    }
    assert.deepEqual(events, [
      FIELD_SURVEY_OPEN_COLLECTION_EVENT,
      FIELD_SURVEY_OPEN_GPS_EVENT,
      FIELD_SURVEY_OPEN_PHOTOS_EVENT,
      FIELD_SURVEY_OPEN_BASEMAPS_EVENT,
      FIELD_SURVEY_NEW_PROJECT_EVENT,
    ]);

    fieldSurveyPlugin.deactivate(app(menus, () => unregistered++));
    assert.equal(unregistered, 1);
  });

  it("re-registers an active menu when labels change", () => {
    const menus: GeoLibreToolbarMenu[] = [];
    let unregistered = 0;
    fieldSurveyPlugin.activate(app(menus, () => unregistered++));

    setFieldSurveyLabels({ menu: "调查", gpsTracking: "定位" });
    assert.equal(unregistered, 1);
    assert.equal(menus[1].label, "调查");
    assert.equal(menus[1].items[1].label, "定位");
  });
});
