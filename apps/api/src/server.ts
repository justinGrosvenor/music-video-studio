import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { join } from "node:path";
import { config } from "./config.js";
import {
  saveUpload,
  readAnalysis,
  writeAnalysisError,
  readAnalysisError,
  clearAnalysisError,
  CorruptAnalysisError,
} from "./storage.js";
import { analyzeFromUrl } from "./audio.js";
import {
  imageToVideo,
  videoToVideo,
  lipSync,
  textToImage,
  textToVideo,
  getTask,
  deleteTask,
  createAvatar,
  listAvatars,
  RunwayRateLimitError,
} from "./runway.js";
import { renderTimeline, writeRenderManifest, renderExists } from "./render.js";
import { FfmpegError } from "./ffmpeg.js";
import { extractLastFrame } from "./frames.js";
import { sliceAudio } from "./audio_slice.js";
import { ensureVocalStem } from "./vocal.js";
import { saveProject, listProjects, loadProject, deleteProject, listRenders } from "./projects.js";
import { saveClip, listClips, deleteClip } from "./clips.js";
import { saveImage, listImages, deleteImage } from "./images.js";
import {
  ImageToVideoRequest,
  VideoToVideoRequest,
  LipSyncRequest,
  TextToImageRequest,
  TextToVideoRequest,
} from "@mvs/shared";

const SafeId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/, "id contains invalid characters");

const app = Fastify({
  logger: { level: "info" },
  bodyLimit: 50 * 1024 * 1024,
});

await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });
await app.register(rateLimit, { max: 200, timeWindow: "1 minute" });
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
await app.register(fastifyStatic, {
  root: join(process.cwd(), config.STORAGE_DIR),
  prefix: "/storage/",
  decorateReply: false,
});

app.setErrorHandler((err, req, reply) => {
  if (err instanceof z.ZodError) {
    return reply.code(400).send({ error: err.errors.map((e) => e.message).join("; ") });
  }
  if (err instanceof RunwayRateLimitError) {
    return reply.code(429).send({
      error: "Runway daily task limit reached. Your limit resets at midnight UTC.",
      rateLimited: true,
    });
  }
  if (err instanceof FfmpegError) {
    // ffmpeg stderr can contain absolute file paths and other internals; log
    // it server-side and only return the generic message to clients.
    req.log.error({ err, stderr: err.stderr }, "ffmpeg failure");
    return reply.code(500).send({ error: err.message });
  }
  req.log.error(err);
  const msg = err instanceof Error ? err.message : String(err);
  return reply.code(500).send({ error: msg });
});

app.get("/health", async () => ({ ok: true }));

// Magic-byte sniffing — MIME headers are caller-controlled and can lie.
// Returns true if the buffer's first bytes match a known signature for the
// declared family (audio | image).
function sniffMatches(buf: Buffer, family: "audio" | "image"): boolean {
  if (buf.length < 12) return false;
  const u = (i: number) => buf.readUInt8(i);
  const ascii = (start: number, len: number) =>
    buf.subarray(start, start + len).toString("ascii");

  if (family === "audio") {
    if (ascii(0, 3) === "ID3") return true; // mp3 with id3
    if (u(0) === 0xff && (u(1) & 0xe0) === 0xe0) return true; // mpeg/aac sync
    if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return true; // wav
    if (ascii(0, 4) === "fLaC") return true; // flac
    if (ascii(0, 4) === "OggS") return true; // ogg/opus
    if (ascii(4, 4) === "ftyp") return true; // m4a/aac-in-mp4
    return false;
  }

  // image
  if (u(0) === 0xff && u(1) === 0xd8 && u(2) === 0xff) return true; // jpeg
  if (u(0) === 0x89 && ascii(1, 3) === "PNG") return true; // png
  if (ascii(0, 4) === "GIF8") return true; // gif
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return true; // webp
  return false;
}

// Songs ----------------------------------------------------------------

app.post("/api/songs/upload", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: "no file" });
  if (!file.mimetype?.startsWith("audio/")) {
    return reply.code(400).send({ error: `expected audio, got ${file.mimetype}` });
  }
  const buf = await file.toBuffer();
  if (!sniffMatches(buf, "audio")) {
    return reply.code(400).send({ error: "file content is not a recognized audio format" });
  }
  const { id, publicUrl } = await saveUpload(buf, file.filename, file.mimetype);

  // Song ids are content-addressed (sha256 over the bytes), so re-uploading
  // the same file after a transient Modal failure hits a stale `${id}.error`
  // and the client gives up immediately. Wipe any prior error before kicking
  // off a fresh analysis run.
  await clearAnalysisError(id);

  // Kick off analysis async; client polls /api/songs/:id/analysis.
  analyzeFromUrl(id, publicUrl).catch(async (err) => {
    app.log.error({ err }, "analysis failed");
    await writeAnalysisError(id, String(err?.message ?? err));
  });

  return reply.send({ id, audioUrl: publicUrl, filename: file.filename });
});

app.post("/api/images/upload", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: "no file" });
  if (!file.mimetype?.startsWith("image/")) {
    return reply.code(400).send({ error: `expected image, got ${file.mimetype}` });
  }
  const buf = await file.toBuffer();
  if (!sniffMatches(buf, "image")) {
    return reply.code(400).send({ error: "file content is not a recognized image format" });
  }
  const { id, publicUrl } = await saveUpload(buf, file.filename, file.mimetype);
  return reply.send({ id, url: publicUrl });
});

app.post("/api/videos/upload", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: "no file" });
  if (!file.mimetype?.startsWith("video/")) {
    return reply.code(400).send({ error: `expected video, got ${file.mimetype}` });
  }
  const buf = await file.toBuffer();
  const { id, publicUrl } = await saveUpload(buf, file.filename, file.mimetype);
  return reply.send({ id, url: publicUrl });
});

app.get("/api/songs/:id/analysis", async (req, reply) => {
  const params = z.object({ id: SafeId }).parse(req.params);
  let analysis;
  try {
    analysis = await readAnalysis(params.id);
  } catch (err) {
    if (err instanceof CorruptAnalysisError) {
      req.log.error({ err, songId: params.id }, "corrupt analysis cache");
      return reply.send({ status: "failed", error: "corrupt analysis cache" });
    }
    throw err;
  }
  if (analysis) return reply.send({ status: "ready", analysis });
  const errMsg = await readAnalysisError(params.id);
  if (errMsg) return reply.send({ status: "failed", error: errMsg });
  return reply.send({ status: "pending" });
});

// Generation primitives ------------------------------------------------

app.post("/api/generate/image-to-video", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
  return reply.send(await imageToVideo(ImageToVideoRequest.parse(req.body)));
});

app.post("/api/generate/video-to-video", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
  return reply.send(await videoToVideo(VideoToVideoRequest.parse(req.body)));
});

app.post("/api/generate/lip-sync", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
  return reply.send(await lipSync(LipSyncRequest.parse(req.body)));
});

app.post("/api/generate/text-to-image", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
  return reply.send(await textToImage(TextToImageRequest.parse(req.body)));
});

app.post("/api/generate/text-to-video", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
  return reply.send(await textToVideo(TextToVideoRequest.parse(req.body)));
});

// Avatars ---------------------------------------------------------------

const CreateAvatarBody = z.object({
  imageUrl: z.string().url(),
  name: z.string().min(1).max(100),
});

app.get("/api/avatars", async (_req, reply) => {
  const avatars = await listAvatars();
  return reply.send({ avatars });
});

app.post("/api/avatars/create", async (req, reply) => {
  const body = CreateAvatarBody.parse(req.body);
  const { avatarId } = await createAvatar(body.imageUrl, body.name);
  return reply.send({ avatarId });
});

// Tasks ----------------------------------------------------------------

app.get("/api/tasks/:id", async (req, reply) => {
  const params = z.object({ id: SafeId }).parse(req.params);
  const raw = await getTask(params.id);
  const task: Record<string, unknown> = {
    id: raw.id,
    status: raw.status,
    createdAt: raw.createdAt,
  };
  if ("progress" in raw) task.progress = raw.progress;
  if ("output" in raw) task.output = raw.output;
  if ("failure" in raw) task.error = raw.failure;
  if ("failureCode" in raw) task.errorCode = raw.failureCode;
  return reply.send(task);
});

app.delete("/api/tasks/:id", async (req, reply) => {
  const params = z.object({ id: SafeId }).parse(req.params);
  await deleteTask(params.id);
  return reply.send({ ok: true });
});

// Frame extraction ------------------------------------------------------

const ExtractFrameBody = z.object({
  videoUrl: z.string().url(),
  time: z.number().min(0).optional(),
});

app.post("/api/videos/extract-last-frame", async (req, reply) => {
  const body = ExtractFrameBody.parse(req.body);
  const result = await extractLastFrame(body.videoUrl, body.time);
  return reply.send(result);
});

// Audio slice -----------------------------------------------------------

const SliceBody = z.object({
  audioUrl: z.string().url(),
  start: z.number().min(0),
  end: z.number().positive(),
});

app.post("/api/audio/slice", async (req, reply) => {
  const body = SliceBody.parse(req.body);
  const result = await sliceAudio(body.audioUrl, body.start, body.end);
  return reply.send(result);
});

// Vocal stem (voice isolation) -----------------------------------------

const VocalStemBody = z.object({
  // songId is accepted for back-compat with older clients but ignored —
  // the cache key is now derived from the audio URL hash so per-region
  // slices can't share a stem with the full song or with each other.
  songId: z.string().optional(),
  audioUrl: z.string().url(),
});

app.post("/api/songs/vocal-stem", async (req, reply) => {
  const body = VocalStemBody.parse(req.body);
  const result = await ensureVocalStem(body.audioUrl);
  return reply.send(result);
});

// Render ---------------------------------------------------------------

// Hard caps so a malformed client can't ask ffmpeg to encode a 10-hour timeline
// or interpolate NaN/Infinity into the filter graph.
const MAX_RENDER_DURATION_S = 60 * 60; // 1h
const MAX_RENDER_CLIPS = 500;

const RenderBody = z
  .object({
    projectId: SafeId,
    audioUrl: z.string().url(),
    duration: z.number().finite().positive().max(MAX_RENDER_DURATION_S),
    clips: z
      .array(
        z
          .object({
            start: z.number().finite().min(0),
            end: z.number().finite().positive(),
            videoUrl: z.string().url(),
          })
          .refine((c) => c.end > c.start, {
            message: "clip end must be greater than start",
          })
      )
      .max(MAX_RENDER_CLIPS),
    fades: z.boolean().default(false),
  })
  .refine((body) => body.clips.every((c) => c.end <= body.duration + 1e-3), {
    message: "clip extends past project duration",
  });

app.post("/api/render", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
  const body = RenderBody.parse(req.body);
  await writeRenderManifest(body.projectId, body);
  const result = await renderTimeline(body);
  return reply.send({ url: result.url });
});

app.get("/api/render/:projectId", async (req, reply) => {
  const params = z.object({ projectId: SafeId }).parse(req.params);
  // Only the local backend knows about local files; S3 callers should track
  // the URL returned from POST /api/render themselves.
  if (renderExists(params.projectId)) {
    return reply.send({
      url: `${config.PUBLIC_BASE_URL}/storage/renders/${params.projectId}.mp4`,
    });
  }
  return reply.code(404).send({ error: "not rendered" });
});

// Projects / Library ----------------------------------------------------

const SaveProjectBody = z.object({
  id: SafeId,
  name: z.string().min(1).max(200),
  state: z.record(z.unknown()),
});

app.get("/api/projects", async (_req, reply) => {
  const projects = await listProjects();
  return reply.send({ projects });
});

app.post("/api/projects/save", async (req, reply) => {
  const body = SaveProjectBody.parse(req.body);
  const meta = await saveProject(body.id, body.name, body.state);
  return reply.send(meta);
});

app.get("/api/projects/:id", async (req, reply) => {
  const params = z.object({ id: SafeId }).parse(req.params);
  const project = await loadProject(params.id);
  if (!project) return reply.code(404).send({ error: "not found" });
  return reply.send(project);
});

app.delete("/api/projects/:id", async (req, reply) => {
  const params = z.object({ id: SafeId }).parse(req.params);
  const deleted = await deleteProject(params.id);
  if (!deleted) return reply.code(404).send({ error: "not found" });
  return reply.send({ ok: true });
});

app.get("/api/library/renders", async (_req, reply) => {
  const renders = await listRenders();
  return reply.send({ renders });
});

// Clip Library ------------------------------------------------------------

const SaveClipBody = z.object({
  id: SafeId,
  name: z.string().min(1).max(200),
  videoUrl: z.string().url(),
  source: z.string(),
  prompt: z.string().nullable(),
  duration: z.number().positive(),
  sectionLabel: z.string().nullable(),
});

app.get("/api/clips", async (_req, reply) => {
  const clips = await listClips();
  return reply.send({ clips });
});

app.post("/api/clips/save", async (req, reply) => {
  const body = SaveClipBody.parse(req.body);
  const saved = await saveClip(body);
  return reply.send(saved);
});

app.delete("/api/clips/:id", async (req, reply) => {
  const params = z.object({ id: SafeId }).parse(req.params);
  const deleted = await deleteClip(params.id);
  if (!deleted) return reply.code(404).send({ error: "not found" });
  return reply.send({ ok: true });
});

// Image Library --------------------------------------------------------
// Namespaced under /api/library to avoid clashing with /api/images/upload.

const SaveImageBody = z.object({
  id: SafeId,
  name: z.string().min(1).max(200),
  url: z.string().url(),
  source: z.string(),
  prompt: z.string().nullable(),
  model: z.string().nullable(),
});

app.get("/api/library/images", async (_req, reply) => {
  const images = await listImages();
  return reply.send({ images });
});

app.post("/api/library/images/save", async (req, reply) => {
  const body = SaveImageBody.parse(req.body);
  const saved = await saveImage(body);
  return reply.send(saved);
});

app.delete("/api/library/images/:id", async (req, reply) => {
  const params = z.object({ id: SafeId }).parse(req.params);
  const deleted = await deleteImage(params.id);
  if (!deleted) return reply.code(404).send({ error: "not found" });
  return reply.send({ ok: true });
});

const port = config.PORT;
app.listen({ port, host: "0.0.0.0" }).then(() => {
  app.log.info(`api listening on http://localhost:${port}`);
});
