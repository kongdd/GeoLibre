import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isCurrentCameraTask,
  readFieldPhoto,
  type FieldPhotoEnvironment,
} from "../apps/geolibre-desktop/src/lib/field-photo";

function largeImage(): Blob & { type: string } {
  return new Blob([new Uint8Array(2 * 1024 * 1024)], { type: "image/png" });
}

function photoEnvironment(mode: "ok" | "context" | "draw" | "encode" = "ok") {
  let closes = 0;
  const source = largeImage();
  const reads: Blob[] = [];
  const bitmap = {
    width: 2_000,
    height: 1_000,
    close: () => {
      closes += 1;
    },
  };
  const environment: FieldPhotoEnvironment = {
    readAsDataUrl: async (blob) => {
      reads.push(blob);
      return "data:image/jpeg;base64,AAAA";
    },
    createBitmap: async () => bitmap,
    createCanvas: () => ({
      width: 0,
      height: 0,
      getContext: () =>
        mode === "context"
          ? null
          : {
              fillStyle: "",
              fillRect: () => undefined,
              drawImage: () => {
                if (mode === "draw") throw new Error("draw failed");
              },
            },
      toBlob: (callback) => {
        if (mode === "encode") throw new Error("encode failed");
        callback(new Blob(["jpeg"], { type: "image/jpeg" }));
      },
    }),
  };
  return { source, environment, reads, closes: () => closes };
}

describe("readFieldPhoto", () => {
  it("does not base64-encode a large source before scaling", async () => {
    const fixture = photoEnvironment();
    const result = await readFieldPhoto(fixture.source, fixture.environment);
    assert.equal(result.dataUrl, "data:image/jpeg;base64,AAAA");
    assert.equal(fixture.reads.includes(fixture.source), false);
    assert.equal(fixture.reads.length, 1);
  });

  for (const mode of ["ok", "context", "draw", "encode"] as const) {
    it(`closes the ImageBitmap exactly once when ${mode} path completes`, async () => {
      const fixture = photoEnvironment(mode);
      await readFieldPhoto(fixture.source, fixture.environment);
      assert.equal(fixture.closes(), 1);
    });
  }
});

describe("camera session barrier", () => {
  it("does not let an old photo task clean up a newer camera session", () => {
    assert.equal(isCurrentCameraTask(4, 4, 8, 9), false);
    assert.equal(isCurrentCameraTask(4, 5, 9, 9), false);
    assert.equal(isCurrentCameraTask(5, 5, 9, 9), true);
  });
});
