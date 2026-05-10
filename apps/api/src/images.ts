import { writeFile, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";
import { ensureDir } from "./storage.js";
import { rehostExternalUrl } from "./rehost.js";
import type { SavedImage } from "@mvs/shared";

const IMAGES_DIR = join(config.STORAGE_DIR, "images");
await ensureDir(IMAGES_DIR);

function imageDir(id: string) {
  return join(IMAGES_DIR, id);
}

/**
 * Persist a SavedImage entry. The asset URL is normalized through
 * rehostExternalUrl: owned URLs (already on /storage or our S3 bucket)
 * pass through unchanged; external URLs (Runway etc.) get downloaded and
 * re-uploaded via the storage backend so the entry survives the remote
 * signed link's ~24–48h expiry. The metadata json lives in this per-id dir.
 */
export async function saveImage(input: {
  id: string;
  name: string;
  url: string;
  source: string;
  prompt: string | null;
  model: string | null;
}): Promise<SavedImage> {
  const dir = imageDir(input.id);
  await ensureDir(dir);

  const url = await rehostExternalUrl(input.url, ".png");

  const saved: SavedImage = {
    id: input.id,
    name: input.name,
    url,
    source: input.source,
    prompt: input.prompt,
    model: input.model,
    savedAt: new Date().toISOString(),
  };

  await writeFile(join(dir, "image.json"), JSON.stringify(saved, null, 2));
  return saved;
}

export async function listImages(): Promise<SavedImage[]> {
  if (!existsSync(IMAGES_DIR)) return [];
  const entries = await readdir(IMAGES_DIR, { withFileTypes: true });
  const images: SavedImage[] = [];

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const metaPath = join(IMAGES_DIR, e.name, "image.json");
    if (!existsSync(metaPath)) continue;
    try {
      images.push(JSON.parse(await readFile(metaPath, "utf8")) as SavedImage);
    } catch { /* skip corrupt */ }
  }

  images.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return images;
}

export async function deleteImage(id: string): Promise<boolean> {
  const dir = imageDir(id);
  if (!existsSync(dir)) return false;
  await rm(dir, { recursive: true, force: true });
  return true;
}
