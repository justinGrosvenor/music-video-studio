import { resolve, normalize, extname } from "node:path";
import { config } from "./config.js";

/**
 * If `url` points to a file in our local storage, return its absolute path.
 * Returns null for external URLs. Throws if the resolved path escapes the
 * storage directory (path-traversal protection).
 */
export function resolveLocalPath(url: string): string | null {
  const prefix = `${config.PUBLIC_BASE_URL}/storage/`;
  if (!url.startsWith(prefix)) return null;
  const root = resolve(process.cwd(), config.STORAGE_DIR);
  const filePath = resolve(root, url.slice(prefix.length));
  if (!normalize(filePath).startsWith(root)) {
    throw new Error("path escapes storage directory");
  }
  return filePath;
}

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".json": "application/json",
};

export function mimeType(ext: string): string {
  return MIME_MAP[ext.toLowerCase()] ?? "application/octet-stream";
}
