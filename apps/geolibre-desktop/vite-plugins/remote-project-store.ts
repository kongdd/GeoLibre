import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import type { Plugin } from "vite";

const ENDPOINT = "/__geolibre_remote_project";
const MAX_BYTES = 600 * 1024 * 1024;
const execFileAsync = promisify(execFile);

const TAURI_ORIGINS = new Set([
  "http://tauri.localhost",
  "https://tauri.localhost",
  "tauri://localhost",
]);

function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).host === host || TAURI_ORIGINS.has(origin);
  } catch {
    return false;
  }
}

function projectTarget(name: string, root: string): string | null {
  if (!name || name.length > 255 || name.includes("\\")) return null;
  const parts = name.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  const lower = name.toLowerCase();
  const project = parts.length === 2 && /\.(geolibre|geolibre\.json|json)$/.test(lower);
  const image =
    parts.length === 3 &&
    parts[1] === "images" &&
    /\.(jpe?g|png|webp|gif)$/.test(lower);
  if (!project && !image) return null;
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...parts);
  return target.startsWith(`${resolvedRoot}${path.sep}`) ? target : null;
}

async function listProjects(root: string): Promise<string[]> {
  let directories;
  try {
    directories = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const projects = await Promise.all(
    directories
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map(async (directory) => {
        const files = await readdir(path.join(root, directory.name), { withFileTypes: true });
        return files
          .filter(
            (entry) =>
              entry.isFile() &&
              !entry.isSymbolicLink() &&
              /\.(geolibre|geolibre\.json|json)$/i.test(entry.name),
          )
          .map((entry) => `${directory.name}/${entry.name}`);
      }),
  );
  return projects.flat().sort();
}

async function readThumbnail(target: string): Promise<{ content: Buffer; jpeg: boolean }> {
  const cacheDir = path.join(path.dirname(path.dirname(target)), ".thumbnails");
  const cached = path.join(cacheDir, `${path.basename(target)}.jpg`);
  try {
    return { content: await readFile(cached), jpeg: true };
  } catch {
    await mkdir(cacheDir, { recursive: true });
  }
  const temporary = `${cached}.${randomUUID()}.tmp.jpg`;
  try {
    await execFileAsync("convert", [
      target,
      "-auto-orient",
      "-thumbnail",
      "480x480>",
      "-strip",
      "-quality",
      "75",
      temporary,
    ]);
    await rename(temporary, cached);
    return { content: await readFile(cached), jpeg: true };
  } catch {
    await rm(temporary, { force: true });
    return { content: await readFile(target), jpeg: false };
  }
}

async function requestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BYTES) throw new Error("Project is too large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function json(res: ServerResponse, status: number, body: object): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export function remoteProjectStore(): Plugin {
  const root = process.env.GEOLIBRE_REMOTE_PROJECT_ROOT || "/mnt/z/GeoLibre";
  const middleware = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const origin = req.headers.origin;
      const allowed = originAllowed(origin, req.headers.host);
      if (origin && allowed) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
      }
      if (req.method === "OPTIONS") {
        if (!allowed) {
          json(res, 403, { detail: "Remote project request refused" });
          return;
        }
        res.statusCode = 204;
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        res.end();
        return;
      }
      if (
        !["GET", "POST"].includes(req.method ?? "") ||
        (req.method === "POST" && !allowed)
      ) {
        json(res, 403, { detail: "Remote project request refused" });
        return;
      }
      const requestUrl = new URL(
        req.url ?? "/",
        origin ?? `http://${req.headers.host ?? "localhost"}`,
      );
      if (req.method === "GET" && requestUrl.searchParams.get("action") === "list") {
        json(res, 200, { projects: await listProjects(root) });
        return;
      }
      const name = requestUrl.searchParams.get("name") ?? "";
      const target = projectTarget(name, root);
      if (!target) {
        json(res, 400, { detail: "Invalid project file name" });
        return;
      }
      if (req.method === "GET") {
        try {
          const isImage = /\.(jpe?g|png|webp|gif)$/i.test(target);
          const thumbnail = isImage && requestUrl.searchParams.get("thumbnail") === "1";
          const result = thumbnail
            ? await readThumbnail(target)
            : { content: await readFile(target), jpeg: false };
          res.statusCode = 200;
          res.setHeader(
            "Content-Type",
            thumbnail && result.jpeg
              ? "image/jpeg"
              : isImage
                ? "application/octet-stream"
                : "application/json",
          );
          res.end(result.content);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            json(res, 404, { detail: "Remote project file not found" });
            return;
          }
          throw error;
        }
        return;
      }
      const content = await requestBody(req);
      await mkdir(path.dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, content);
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true });
      }
      json(res, 200, { path: target });
    } catch (error) {
      json(res, 500, {
        detail: error instanceof Error ? error.message : "Remote project request failed",
      });
    }
  };
  return {
    name: "geolibre-remote-project-store",
    configureServer(server) {
      server.middlewares.use(ENDPOINT, middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(ENDPOINT, middleware);
    },
  };
}
