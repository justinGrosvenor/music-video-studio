import { z } from "zod";

const optionalUrl = z
  .string()
  .transform((v) => (v.trim() === "" ? undefined : v))
  .pipe(z.string().url().optional());

const optionalNonEmpty = z
  .string()
  .transform((v) => (v.trim() === "" ? undefined : v))
  .pipe(z.string().min(1).optional());

const Env = z.object({
  RUNWAYML_API_SECRET: optionalNonEmpty.optional(),
  MODAL_AUDIO_URL: optionalUrl.optional(),
  PORT: z.coerce.number().default(3001),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3001"),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  STORAGE_DIR: z.string().default("./storage"),
  STORAGE_BACKEND: z.enum(["local", "s3"]).default("local"),
  S3_BUCKET: optionalNonEmpty.optional(),
  S3_REGION: optionalNonEmpty.optional(),
  /** Override the public URL base for S3 objects (e.g. a CloudFront domain).
   * When unset, virtual-hosted-style S3 URLs are used. */
  S3_PUBLIC_URL_BASE: optionalUrl.optional(),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error("invalid env:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  console.error("\ncopy .env.example to .env at the repo root and fill in values.");
  process.exit(1);
}

export const config = parsed.data;

if (!config.RUNWAYML_API_SECRET) {
  console.warn(
    "WARN: RUNWAYML_API_SECRET is not set. /api/generate/* calls will 401. " +
      "Other endpoints (audio, render) still work."
  );
}
if (!config.MODAL_AUDIO_URL) {
  console.warn(
    "WARN: MODAL_AUDIO_URL is not set. Song uploads will analyze nothing. " +
      "Deploy modal/audio_analysis.py and put the URL in .env."
  );
}
if (config.STORAGE_BACKEND === "s3") {
  if (!config.S3_BUCKET || !config.S3_REGION) {
    console.error("STORAGE_BACKEND=s3 requires S3_BUCKET and S3_REGION");
    process.exit(1);
  }
} else {
  console.warn("STORAGE_BACKEND=local — uploads stored on container disk only (ephemeral).");
}

export type Config = z.infer<typeof Env>;
