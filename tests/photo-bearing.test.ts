import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizePhotoBearing,
  photoBearingFromOrientation,
} from "../apps/geolibre-desktop/src/lib/photo-bearing";

describe("photo bearing", () => {
  it("normalizes and rounds azimuths", () => {
    assert.equal(normalizePhotoBearing(370.04), 10);
    assert.equal(normalizePhotoBearing(-10), 350);
    assert.equal(normalizePhotoBearing(Number.NaN), null);
  });

  it("prefers the iOS compass heading", () => {
    assert.equal(
      photoBearingFromOrientation({
        alpha: null,
        beta: null,
        gamma: null,
        absolute: false,
        webkitCompassHeading: 123.45,
        webkitCompassAccuracy: 8,
      }),
      123.5,
    );
  });

  it("derives a heading from absolute Android orientation", () => {
    assert.equal(
      photoBearingFromOrientation({
        alpha: 0,
        beta: 90,
        gamma: 0,
        absolute: true,
      }),
      0,
    );
  });

  it("rejects relative, flat, or uncalibrated readings", () => {
    assert.equal(
      photoBearingFromOrientation({
        alpha: 20,
        beta: 0,
        gamma: 0,
        absolute: true,
      }),
      null,
    );
    assert.equal(
      photoBearingFromOrientation({
        alpha: 20,
        beta: 80,
        gamma: 0,
        absolute: false,
      }),
      null,
    );
    assert.equal(
      photoBearingFromOrientation({
        alpha: null,
        beta: null,
        gamma: null,
        absolute: false,
        webkitCompassHeading: 20,
        webkitCompassAccuracy: -1,
      }),
      null,
    );
  });
});
