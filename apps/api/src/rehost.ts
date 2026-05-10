import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";

/**
 * Download a remote (typically Runway) URL into a local destination directory
 * and return a public-facing path under the configured PUBLIC_BASE_URL.
 *
 * Why: Runway-hosted output URLs (image / video / audio) expire 24–48h after
 * creation. If we save those raw URLs into the clip / image / project library,
 * the saved entries silently rot. Rehosting at save-time guarantees durability.
 *
 * Returns the original URL on any failure — caller should still record the
 * entry, just with the warning that it may expire.
 */
export async function rehostExternalUrl(opts: {
  url: string;
  destDir: string;
  /** Path segment after `${PUBLIC_BASE_URL}/storage/` for the rehosted URL. */
  publicPathPrefix: string;
  publicBaseUrl: string;
  /** Filename to write inside destDir; auto-derived from the URL if omitted. */
  filename?: string;
  /** Default extension if URL lacks one (e.g. signed Runway URLs without ext). */
  defaultExt?: string;
}): Promise<string> {
  const { url, destDir, publicPathPrefix, publicBaseUrl, defaultExt = ".bin" } = opts;
  if (!/^https?:\/\//i.test(url)) return url;

  const urlPath = url.split("?")[0] || "";
  const inferredExt = extname(urlPath) || defaultExt;
  const filename = opts.filename ?? `asset${inferredExt}`;
  const dest = join(destDir, filename);

  if (existsSync(dest)) {
    return `${publicBaseUrl}/storage/${publicPathPrefix}/${filename}`;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(dest, buf);
    return `${publicBaseUrl}/storage/${publicPathPrefix}/${filename}`;
  } catch (err) {
    console.warn(`rehost failed for ${url}; keeping external URL`, err);
    return url;
  }
}
