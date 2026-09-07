import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { FeatureCollection, Point } from "geojson";
import {
  observationPhotoSinkActive,
  observationPhotosFromResult,
  offerObservationPhotos,
  setObservationPhotoSink,
  type GeotaggedPhotoResult,
} from "../apps/geolibre-desktop/src/lib/geotagged-photos";

afterEach(() => setObservationPhotoSink(null));

function result(
  features: FeatureCollection<Point>["features"]
): GeotaggedPhotoResult {
  return {
    featureCollection: { type: "FeatureCollection", features },
    total: features.length,
    located: features.length,
    skipped: 0,
    withoutThumbnail: 0,
  };
}

describe("observation photo insert", () => {
  it("extracts thumbnail, name, and bearing", () => {
    assert.deepEqual(
      observationPhotosFromResult(
        result([
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: {
              photo: "data:image/jpeg;base64,abc",
              name: "plot.jpg",
              direction: 45,
            },
          },
        ])
      ),
      {
        photos: ["data:image/jpeg;base64,abc"],
        photoNames: ["plot.jpg"],
        photoBearings: [45],
      }
    );
  });

  it("offers photos to the open observation and skips a new layer", () => {
    const received: string[] = [];
    setObservationPhotoSink((batch) => {
      received.push(...batch.photos);
      return true;
    });
    assert.equal(observationPhotoSinkActive(), true);
    assert.equal(
      offerObservationPhotos(
        result([
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [1, 2] },
            properties: { photo: "data:image/jpeg;base64,x", name: "a.jpg" },
          },
        ])
      ),
      true
    );
    assert.deepEqual(received, ["data:image/jpeg;base64,x"]);
  });

  it("falls through to a photo layer when no observation is open", () => {
    assert.equal(observationPhotoSinkActive(), false);
    assert.equal(
      offerObservationPhotos(
        result([
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [1, 2] },
            properties: { photo: "data:image/jpeg;base64,x" },
          },
        ])
      ),
      false
    );
  });
});
