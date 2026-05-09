import { mkdir, writeFile, readFile, readdir, rm, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { config } from "./config.js";
import { ensureDir } from "./storage.js";
import { resolveLocalPath } from "./paths.js";
import type { SavedClip } from "@mvs/shared";

const CLIPS_DIR = join(config.STORAGE_DIR, "clips");
await ensureDir(CLIPS_DIR);

function clipDir(id: string) {
  return join(CLIPS_DIR, id);
}


export async function saveClip(input: {
  id: string;
  name: string;
  videoUrl: string;
  source: string;
  prompt: string | null;
  duration: number;
  sectionLabel: string | null;
}): Promise<SavedClip> {
  const dir = clipDir(input.id);
  await ensureDir(dir);

  let videoUrl = input.videoUrl;
  const localPath = resolveLocalPath(input.videoUrl);
  if (localPath && existsSync(localPath)) {
    const filename = basename(localPath);
    const dest = join(dir, filename);
    if (!existsSync(dest)) await copyFile(localPath, dest);
    videoUrl = `${config.PUBLIC_BASE_URL}/storage/clips/${input.id}/${filename}`;
  }

  const saved: SavedClip = {
    id: input.id,
    name: input.name,
    videoUrl,
    source: input.source,
    prompt: input.prompt,
    duration: input.duration,
    sectionLabel: input.sectionLabel,
    savedAt: new Date().toISOString(),
  };

  await writeFile(join(dir, "clip.json"), JSON.stringify(saved, null, 2));
  return saved;
}

export async function listClips(): Promise<SavedClip[]> {
  if (!existsSync(CLIPS_DIR)) return [];
  const entries = await readdir(CLIPS_DIR, { withFileTypes: true });
  const clips: SavedClip[] = [];

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const metaPath = join(CLIPS_DIR, e.name, "clip.json");
    if (!existsSync(metaPath)) continue;
    try {
      clips.push(JSON.parse(await readFile(metaPath, "utf8")) as SavedClip);
    } catch { /* skip corrupt */ }
  }

  clips.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return clips;
}

export async function deleteClip(id: string): Promise<boolean> {
  const dir = clipDir(id);
  if (!existsSync(dir)) return false;
  await rm(dir, { recursive: true, force: true });
  return true;
}
