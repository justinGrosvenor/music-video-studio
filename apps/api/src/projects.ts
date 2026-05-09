import { mkdir, writeFile, readFile, readdir, rm, copyFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { config } from "./config.js";
import { ensureDir } from "./storage.js";
import { resolveLocalPath } from "./paths.js";
import type { ProjectMeta, SavedProject } from "@mvs/shared";

const PROJECTS_DIR = join(config.STORAGE_DIR, "projects");
await ensureDir(PROJECTS_DIR);

function projectDir(id: string) {
  return join(PROJECTS_DIR, id);
}


export async function saveProject(
  id: string,
  name: string,
  state: Record<string, unknown>,
): Promise<ProjectMeta> {
  const dir = projectDir(id);
  await ensureDir(dir);
  const filesDir = join(dir, "files");
  await ensureDir(filesDir);

  const copiedFiles = new Map<string, string>();
  const fileUrls = collectUrls(state);

  for (const url of fileUrls) {
    const localPath = resolveLocalPath(url);
    if (!localPath || !existsSync(localPath)) continue;
    const filename = basename(localPath);
    const dest = join(filesDir, filename);
    if (!existsSync(dest)) await copyFile(localPath, dest);
    copiedFiles.set(url, `${config.PUBLIC_BASE_URL}/storage/projects/${id}/files/${filename}`);
  }

  const rewritten = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
  rewriteUrls(rewritten, copiedFiles);

  let thumbnailUrl: string | null = null;
  const clips = state.clips;
  if (Array.isArray(clips)) {
    const ready = clips.find((c: any) => c.status === "ready" && c.videoUrl);
    if (ready) thumbnailUrl = copiedFiles.get(ready.videoUrl) ?? ready.videoUrl;
  }

  const savedAt = new Date().toISOString();
  const meta: ProjectMeta = { id, name, savedAt, thumbnailUrl };
  const saved: SavedProject = { ...meta, state: rewritten, files: [...copiedFiles.values()] };

  await writeFile(join(dir, "project.json"), JSON.stringify(saved, null, 2));
  return meta;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  if (!existsSync(PROJECTS_DIR)) return [];
  const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
  const metas: ProjectMeta[] = [];

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const metaPath = join(PROJECTS_DIR, e.name, "project.json");
    if (!existsSync(metaPath)) continue;
    try {
      const raw = JSON.parse(await readFile(metaPath, "utf8")) as SavedProject;
      metas.push({ id: raw.id, name: raw.name, savedAt: raw.savedAt, thumbnailUrl: raw.thumbnailUrl });
    } catch { /* skip corrupt */ }
  }

  metas.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return metas;
}

export async function loadProject(id: string): Promise<SavedProject | null> {
  const metaPath = join(projectDir(id), "project.json");
  if (!existsSync(metaPath)) return null;
  return JSON.parse(await readFile(metaPath, "utf8")) as SavedProject;
}

export async function deleteProject(id: string): Promise<boolean> {
  const dir = projectDir(id);
  if (!existsSync(dir)) return false;
  await rm(dir, { recursive: true, force: true });
  return true;
}

export async function listRenders(): Promise<Array<{ name: string; url: string; size: number; modifiedAt: string }>> {
  const rendersDir = join(config.STORAGE_DIR, "renders");
  if (!existsSync(rendersDir)) return [];
  const entries = await readdir(rendersDir);
  const renders: Array<{ name: string; url: string; size: number; modifiedAt: string }> = [];

  for (const name of entries) {
    if (!name.endsWith(".mp4")) continue;
    const filePath = join(rendersDir, name);
    const s = await stat(filePath);
    renders.push({
      name,
      url: `${config.PUBLIC_BASE_URL}/storage/renders/${name}`,
      size: s.size,
      modifiedAt: s.mtime.toISOString(),
    });
  }

  renders.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return renders;
}

function collectUrls(obj: unknown, urls = new Set<string>()): Set<string> {
  if (typeof obj === "string" && (obj.startsWith("http://") || obj.startsWith("https://"))) {
    urls.add(obj);
  } else if (Array.isArray(obj)) {
    for (const item of obj) collectUrls(item, urls);
  } else if (obj && typeof obj === "object") {
    for (const val of Object.values(obj)) collectUrls(val, urls);
  }
  return urls;
}

function rewriteUrls(obj: any, map: Map<string, string>) {
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === "string" && map.has(obj[i])) {
        obj[i] = map.get(obj[i]);
      } else {
        rewriteUrls(obj[i], map);
      }
    }
  } else if (obj && typeof obj === "object") {
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === "string" && map.has(obj[key])) {
        obj[key] = map.get(obj[key]);
      } else {
        rewriteUrls(obj[key], map);
      }
    }
  }
}
