import { extname } from "node:path";
import { config } from "./config.js";
import { storage } from "./storage.js";

/**
 * Make `url` durable. Two cases:
 *
 *   - Already-owned storage URLs (Fastify's `/storage/*` or our S3 bucket)
 *     pass through unchanged — they're already durable on the backend that
 *     issued them.
 *   - External URLs (typically Runway-hosted outputs that expire ~24–48h
 *     after generation) get fetched and re-uploaded via the configured
 *     storage backend, returning the new content-addressed URL.
 *
 * On any fetch / write failure the original URL is returned unchanged so the
 * caller can still record the entry, with a console warning. The caller is
 * responsible for surfacing that the link may rot.
 */
export async function rehostExternalUrl(
  url: string,
  defaultExt = ".bin",
): Promise<string> {
  if (!/^https?:\/\//i.test(url)) return url;
  if (isOwnedStorageUrl(url)) return url;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const inferredExt = extname(url.split("?")[0] || "") || defaultExt;
    const filename = `rehosted${inferredExt}`;
    const { publicUrl } = await storage.saveUpload(buf, filename);
    return publicUrl;
  } catch (err) {
    console.warn(`rehost failed for ${url}; keeping external URL`, err);
    return url;
  }
}

/** Does `url` already point at one of our storage backends? */
function isOwnedStorageUrl(url: string): boolean {
  // Local backend: Fastify-served /storage/*
  if (url.startsWith(`${config.PUBLIC_BASE_URL}/storage/`)) return true;
  // S3 backend (default URL form: https://<bucket>.s3.<region>.amazonaws.com/...)
  if (config.S3_BUCKET && config.S3_REGION) {
    const s3Default = `https://${config.S3_BUCKET}.s3.${config.S3_REGION}.amazonaws.com/`;
    if (url.startsWith(s3Default)) return true;
  }
  // S3 backend with custom public URL base (e.g. CloudFront in front of S3)
  if (config.S3_PUBLIC_URL_BASE && url.startsWith(config.S3_PUBLIC_URL_BASE)) {
    return true;
  }
  return false;
}
