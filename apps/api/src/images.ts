import { writeFile, readFile, readdir, rm, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { config } from "./config.js";
import { ensureDir } from "./storage.js";
import { resolveLocalPath } from "./paths.js";
import { rehostExternalUrl } from "./rehost.js";
import type { SavedImage } from "@mvs/shared";

const IMAGES_DIR = join(config.STORAGE_DIR, "images");
await ensureDir(IMAGES_DIR);

function imageDir(id: string) {
  return join(IMAGES_DIR, id);
}

/**
 * Persist a SavedImage entry. If the URL points at our own /storage tree,
 * copy the file into the per-id image directory so it survives even if the
 * original upload is removed. External URLs (Runway, etc.) are stored by
 * reference — they may expire 24–48h after creation.
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

  let url = input.url;
  const localPath = resolveLocalPath(input.url);
  if (localPath && existsSync(localPath)) {
    const filename = basename(localPath);
    const dest = join(dir, filename);
    if (!existsSync(dest)) await copyFile(localPath, dest);
    url = `${config.PUBLIC_BASE_URL}/storage/images/${input.id}/${filename}`;
  } else if (/^https?:\/\//i.test(input.url)) {
    // External (Runway) URL: download so the library entry survives the
    // remote signed link's ~24–48h expiry.
    const ext = extname(input.url.split("?")[0] || "") || ".png";
    url = await rehostExternalUrl({
      url: input.url,
      destDir: dir,
      publicPathPrefix: `images/${input.id}`,
      publicBaseUrl: config.PUBLIC_BASE_URL,
      filename: `image${ext}`,
      defaultExt: ".png",
    });
  }

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
