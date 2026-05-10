import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { AudioAnalysis } from "@mvs/shared";
import { config } from "./config.js";
import { mimeType } from "./paths.js";

export class CorruptAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorruptAnalysisError";
  }
}

const UPLOADS = join(config.STORAGE_DIR, "uploads");
const ANALYSES = join(config.STORAGE_DIR, "analyses");
const RENDERS = join(config.STORAGE_DIR, "renders");

await ensureDir(UPLOADS);
await ensureDir(ANALYSES);
await ensureDir(RENDERS);

export async function ensureDir(p: string) {
  if (!existsSync(p)) await mkdir(p, { recursive: true });
}

export function hashBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

export const paths = { UPLOADS, ANALYSES, RENDERS };

// --- Storage backend abstraction ---------------------------------------
//
// Two implementations:
//   - local: writes to STORAGE_DIR; URLs go through Fastify's static serve.
//     Fine for dev. On Fargate, container-local disk is ephemeral.
//   - s3:    PutObject to S3_BUCKET; URLs are virtual-hosted-style or
//            S3_PUBLIC_URL_BASE (CloudFront). Survives container restarts.

export interface StorageBackend {
  /** Persist an uploaded blob. Idempotent on content (same buffer → same id). */
  saveUpload(
    buf: Buffer,
    originalName: string,
    contentType?: string
  ): Promise<{ id: string; publicUrl: string }>;
  /** Persist a finished render produced at a local file path. The local file
   * is left on disk in case the caller wants it; callers may delete after. */
  saveRender(localPath: string, key: string, contentType?: string): Promise<{ publicUrl: string }>;
}

class LocalBackend implements StorageBackend {
  async saveUpload(buf: Buffer, originalName: string) {
    const id = hashBuffer(buf);
    const ext = extname(originalName) || ".bin";
    const filename = `${id}${ext}`;
    const path = join(UPLOADS, filename);
    try {
      await writeFile(path, buf, { flag: "wx" });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    return {
      id,
      publicUrl: `${config.PUBLIC_BASE_URL}/storage/uploads/${filename}`,
    };
  }

  async saveRender(localPath: string, key: string) {
    // The render is already where Fastify's static handler can serve it.
    // We just need to make sure it's at storage/renders/<key>.
    const dest = join(RENDERS, key);
    if (localPath !== dest) await rename(localPath, dest);
    return { publicUrl: `${config.PUBLIC_BASE_URL}/storage/renders/${key}` };
  }
}

class S3Backend implements StorageBackend {
  private client: S3Client;
  private bucket: string;
  private region: string;
  private publicBase: string;

  constructor() {
    this.bucket = config.S3_BUCKET!;
    this.region = config.S3_REGION!;
    this.client = new S3Client({ region: this.region });
    this.publicBase =
      config.S3_PUBLIC_URL_BASE ?? `https://${this.bucket}.s3.${this.region}.amazonaws.com`;
  }

  private url(key: string): string {
    return `${this.publicBase}/${key}`;
  }

  async saveUpload(buf: Buffer, originalName: string, contentType?: string) {
    const id = hashBuffer(buf);
    const ext = extname(originalName) || ".bin";
    const key = `uploads/${id}${ext}`;

    // Skip the upload if the same content is already there. PutObject is idempotent
    // on identical bodies but a HEAD round-trip is cheaper than re-uploading large audio.
    const existing = await this.head(key);
    if (!existing) {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buf,
          ContentType: contentType ?? mimeType(ext),
          CacheControl: "public, max-age=31536000, immutable",
        })
      );
    }
    return { id, publicUrl: this.url(key) };
  }

  async saveRender(localPath: string, key: string, contentType?: string) {
    const objectKey = `renders/${key}`;
    const ext = extname(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: await readFile(localPath),
        ContentType: contentType ?? mimeType(ext),
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
    return { publicUrl: this.url(objectKey) };
  }

  private async head(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}

export const storage: StorageBackend =
  config.STORAGE_BACKEND === "s3" ? new S3Backend() : new LocalBackend();

// Convenience wrapper used by the upload endpoints.
export async function saveUpload(buf: Buffer, originalName: string, contentType?: string) {
  return storage.saveUpload(buf, originalName, contentType);
}

// --- Analysis cache (always local; cheap to recompute) -------------------

export async function readAnalysis(songId: string): Promise<AudioAnalysis | null> {
  const path = join(ANALYSES, `${songId}.json`);
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CorruptAnalysisError(`analysis cache for ${songId} is not valid JSON`);
  }
  const result = AudioAnalysis.safeParse(parsed);
  if (!result.success) {
    throw new CorruptAnalysisError(
      `analysis cache for ${songId} does not match schema: ${result.error.message}`
    );
  }
  return result.data;
}

export async function writeAnalysis(songId: string, data: AudioAnalysis): Promise<void> {
  const path = join(ANALYSES, `${songId}.json`);
  await writeFile(path, JSON.stringify(data, null, 2));
}

export async function writeAnalysisError(songId: string, error: string): Promise<void> {
  const path = join(ANALYSES, `${songId}.error`);
  await writeFile(path, error);
}

export async function readAnalysisError(songId: string): Promise<string | null> {
  const path = join(ANALYSES, `${songId}.error`);
  if (!existsSync(path)) return null;
  return readFile(path, "utf8");
}

export async function clearAnalysisError(songId: string): Promise<void> {
  const path = join(ANALYSES, `${songId}.error`);
  if (!existsSync(path)) return;
  await rm(path, { force: true });
}

export async function readVocalStemUrl(songId: string): Promise<string | null> {
  const path = join(ANALYSES, `${songId}.vocal.json`);
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf8");
  try {
    const obj = JSON.parse(raw);
    return typeof obj.url === "string" ? obj.url : null;
  } catch {
    return null;
  }
}

export async function writeVocalStemUrl(songId: string, url: string): Promise<void> {
  const path = join(ANALYSES, `${songId}.vocal.json`);
  await writeFile(path, JSON.stringify({ url }, null, 2));
}
