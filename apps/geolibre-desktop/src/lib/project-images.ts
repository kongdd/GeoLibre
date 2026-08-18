// Pull inline photo data URLs out of a project JSON into images/, and put them
// back on load. Other layer data stays in the JSON.

const DATA_URL =
  /^data:image\/(?!svg\+xml(?:;|,))([-+.\w]+);base64,([a-z\d+/]+={0,2})$/i;
const IMAGE_REF = /^images\/[^./][^/]*\.(jpe?g|png|webp|gif)$/i;

const MIME_EXT: Record<string, string> = {
  jpeg: "jpg",
  jpg: "jpg",
  png: "png",
  webp: "webp",
  gif: "gif",
};

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export interface ExternalizedProjectImages {
  content: string;
  files: { path: string; bytes: Uint8Array }[];
}

export function bytesFromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function extFromMime(mime: string): string | null {
  const subtype = mime.split("+", 1)[0]?.toLowerCase() ?? "";
  return MIME_EXT[subtype] ?? null;
}

function hashHex(bytes: Uint8Array): string {
  let hash = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function walkStrings(value: unknown, rewrite: (text: string) => string): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (typeof item === "string") value[i] = rewrite(item);
      else walkStrings(item, rewrite);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string") record[key] = rewrite(item);
    else walkStrings(item, rewrite);
  }
}

export function externalizeProjectImages(content: string): ExternalizedProjectImages {
  if (!content.includes("data:image/")) return { content, files: [] };
  const project = JSON.parse(content) as unknown;
  const files = new Map<string, Uint8Array>();
  walkStrings(project, (text) => {
    const match = text.match(DATA_URL);
    if (!match) return text;
    const ext = extFromMime(match[1]);
    if (!ext) return text;
    const bytes = bytesFromBase64(match[2]);
    const path = `images/${hashHex(bytes)}.${ext}`;
    files.set(path, bytes);
    return path;
  });
  return {
    content: JSON.stringify(project),
    files: [...files].map(([path, bytes]) => ({ path, bytes })),
  };
}

export async function hydrateProjectImages(
  content: string,
  read: (path: string) => Promise<Uint8Array | null>,
): Promise<string> {
  if (!content.includes('"images/')) return content;
  const project = JSON.parse(content) as unknown;
  const cache = new Map<string, string>();
  const pending: Promise<void>[] = [];
  walkStrings(project, (text) => {
    if (!IMAGE_REF.test(text) || cache.has(text)) return cache.get(text) ?? text;
    cache.set(text, text);
    pending.push(
      read(text).then((bytes) => {
        if (!bytes) return;
        const ext = text.split(".").pop()?.toLowerCase() ?? "";
        const mime = EXT_MIME[ext];
        if (!mime) return;
        cache.set(text, `data:${mime};base64,${base64FromBytes(bytes)}`);
      }),
    );
    return text;
  });
  await Promise.all(pending);
  walkStrings(project, (text) => cache.get(text) ?? text);
  return JSON.stringify(project);
}
