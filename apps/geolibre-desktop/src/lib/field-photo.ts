import { MAX_PHOTO_BYTES } from "./field-collection";

export const MAX_PHOTO_SOURCE_BYTES = 25 * 1024 * 1024;
export const MAX_PHOTO_EDGE = 1600;

export type PhotoReadResult = {
  dataUrl: string | null;
  issue?: "large" | "read";
};

type BitmapLike = {
  width: number;
  height: number;
  close: () => void;
};

type CanvasLike = {
  width: number;
  height: number;
  getContext: (kind: "2d") => {
    fillStyle: string;
    fillRect: (x: number, y: number, width: number, height: number) => void;
    drawImage: (
      image: BitmapLike,
      x: number,
      y: number,
      width: number,
      height: number
    ) => void;
  } | null;
  toBlob: (
    callback: (blob: Blob | null) => void,
    type: string,
    quality: number
  ) => void;
};

export interface FieldPhotoEnvironment {
  readAsDataUrl: (blob: Blob) => Promise<string | null>;
  createBitmap: (blob: Blob) => Promise<BitmapLike>;
  createCanvas: () => CanvasLike;
}

function browserEnvironment(): FieldPhotoEnvironment {
  return {
    readAsDataUrl: (blob) =>
      new Promise((resolve) => {
        const reader = new FileReader();
        reader.onerror = () => resolve(null);
        reader.onload = () =>
          resolve(typeof reader.result === "string" ? reader.result : null);
        reader.readAsDataURL(blob);
      }),
    createBitmap: (blob) =>
      createImageBitmap(blob, { imageOrientation: "from-image" }),
    createCanvas: () =>
      document.createElement("canvas") as unknown as CanvasLike,
  };
}

function estimatedDataUrlLength(file: Blob & { type?: string }): number {
  return (
    `data:${file.type || "application/octet-stream"};base64,`.length +
    Math.ceil(file.size / 3) * 4
  );
}

function canvasBlob(canvas: CanvasLike, quality: number): Promise<Blob | null> {
  return new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality)
  );
}

/** Read a camera image, avoiding an original base64 copy when scaling is required. */
export async function readFieldPhoto(
  file: Blob & { type: string },
  environment: FieldPhotoEnvironment = browserEnvironment()
): Promise<PhotoReadResult> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    return { dataUrl: null, issue: "read" };
  }
  if (file.size > MAX_PHOTO_SOURCE_BYTES)
    return { dataUrl: null, issue: "large" };

  if (estimatedDataUrlLength(file) <= MAX_PHOTO_BYTES) {
    const original = await environment.readAsDataUrl(file);
    return original ? { dataUrl: original } : { dataUrl: null, issue: "read" };
  }

  let bitmap: BitmapLike | null = null;
  try {
    bitmap = await environment.createBitmap(file);
    const scale = Math.min(
      1,
      MAX_PHOTO_EDGE / Math.max(bitmap.width, bitmap.height)
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = environment.createCanvas();
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return { dataUrl: null, issue: "read" };
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);

    for (const quality of [0.85, 0.7, 0.55]) {
      const blob = await canvasBlob(canvas, quality);
      if (!blob) continue;
      const dataUrl = await environment.readAsDataUrl(blob);
      if (dataUrl && dataUrl.length <= MAX_PHOTO_BYTES) return { dataUrl };
    }
    return { dataUrl: null, issue: "large" };
  } catch {
    return { dataUrl: null, issue: "read" };
  } finally {
    bitmap?.close();
  }
}

/** A stale photo task must not tear down a newer camera-direction session. */
export function isCurrentCameraTask(
  taskPhotoSeq: number,
  currentPhotoSeq: number,
  taskCameraSessionId: number,
  currentCameraSessionId: number
): boolean {
  return (
    taskPhotoSeq === currentPhotoSeq &&
    taskCameraSessionId === currentCameraSessionId
  );
}
