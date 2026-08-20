import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseBoundedNumberDraft } from "../apps/geolibre-desktop/src/lib/clamp";

describe("numeric style input", () => {
  it("keeps an out-of-range first digit editable until a valid second digit arrives", () => {
    assert.equal(parseBoundedNumberDraft("1", 6, 96), null);
    assert.equal(parseBoundedNumberDraft("12", 6, 96), 12);
  });

  it("rejects temporary invalid drafts without clamping them", () => {
    assert.equal(parseBoundedNumberDraft("", 6, 96), null);
    assert.equal(parseBoundedNumberDraft("-", 6, 96), null);
    assert.equal(parseBoundedNumberDraft("100", 6, 96), null);
  });

  it("rounds valid drafts to the configured step precision", () => {
    assert.equal(parseBoundedNumberDraft("1.26", 0, 10, 1), 1.3);
  });
});
