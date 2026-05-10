import { writeFile, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";
import { ensureDir } from "./storage.js";
import { rehostExternalUrl } from "./rehost.js";
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

  // rehostExternalUrl is the single source of truth for "make this URL
  // durable on our storage backend": owned URLs (already on /storage or
  // our S3 bucket) pass through; external URLs (Runway etc.) get downloaded
  // and re-uploaded via storage.saveUpload, so the result is always on the
  // configured backend (S3 in prod, local disk in dev). The metadata json
  // we write below stays in this per-id directory either way.
  const videoUrl = await rehostExternalUrl(input.videoUrl, ".mp4");

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
