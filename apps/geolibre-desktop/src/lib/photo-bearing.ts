/** Normalize a compass bearing to [0, 360), rounded to 0.1°. */
export function normalizePhotoBearing(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const normalized = ((value % 360) + 360) % 360;
  return Math.round(normalized * 10) / 10;
}

export interface OrientationReading {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  absolute: boolean;
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

/** Convert an absolute DeviceOrientation reading to the camera-facing azimuth. */
export function photoBearingFromOrientation(reading: OrientationReading): number | null {
  const { webkitCompassHeading, webkitCompassAccuracy } = reading;
  if (
    typeof webkitCompassHeading === "number" &&
    Number.isFinite(webkitCompassHeading) &&
    (webkitCompassAccuracy == null || webkitCompassAccuracy >= 0)
  ) {
    return normalizePhotoBearing(webkitCompassHeading);
  }
  if (
    !reading.absolute ||
    reading.alpha == null ||
    reading.beta == null ||
    reading.gamma == null
  ) {
    return null;
  }

  const alpha = (reading.alpha * Math.PI) / 180;
  const beta = (reading.beta * Math.PI) / 180;
  const gamma = (reading.gamma * Math.PI) / 180;
  const a = -Math.cos(alpha) * Math.sin(gamma) -
    Math.sin(alpha) * Math.sin(beta) * Math.cos(gamma);
  const b =
    -Math.sin(alpha) * Math.sin(gamma) +
    Math.cos(alpha) * Math.sin(beta) * Math.cos(gamma);
  // A flat device has no horizontal camera-axis projection, so azimuth is undefined.
  if (Math.hypot(a, b) < 1e-6) return null;
  let heading = Math.atan2(a, b);
  if (heading < 0) heading += 2 * Math.PI;
  return normalizePhotoBearing((heading * 180) / Math.PI);
}

/** Request iOS motion/orientation access; other platforms need no prompt. */
export async function requestPhotoBearingPermission(): Promise<boolean> {
  const orientation = globalThis.DeviceOrientationEvent as
    | (typeof DeviceOrientationEvent & {
        requestPermission?: () => Promise<"granted" | "denied">;
      })
    | undefined;
  if (!orientation?.requestPermission) return true;
  try {
    return (await orientation.requestPermission()) === "granted";
  } catch {
    return false;
  }
}
