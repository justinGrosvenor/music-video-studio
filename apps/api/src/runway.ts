import RunwayML from "@runwayml/sdk";
import { toFile } from "@runwayml/sdk/uploads";
import type {
  ImageToVideoRequest,
  VideoToVideoRequest,
  LipSyncRequest,
  VoiceIsolationRequest,
  ActTwoRequest,
  TextToImageRequest,
  TextToVideoRequest,
} from "@mvs/shared";
import { readFile } from "node:fs/promises";
import { extname, basename } from "node:path";
import sharp from "sharp";
import { config } from "./config.js";
import { resolveLocalPath, mimeType } from "./paths.js";
import { pollUntil } from "./poll.js";

// SDK requires an apiKey at construction. Use a placeholder when missing so the
// server can still boot for UI / audio / render development; any /api/generate/*
// call will fail with a clear 401 from Runway, which is what we want.
export const runway = new RunwayML({
  apiKey: config.RUNWAYML_API_SECRET ?? "missing-RUNWAYML_API_SECRET",
});
const RUNWAY_BASE = process.env.RUNWAYML_BASE_URL ?? "https://api.dev.runwayml.com";

export type RunwayTask = { id: string };

export class RunwayRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunwayRateLimitError";
  }
}

function rethrowRunway(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.includes("429") ||
    msg.toLowerCase().includes("rate limit") ||
    msg.toLowerCase().includes("task limit") ||
    msg.toLowerCase().includes("too many requests")
  ) {
    throw new RunwayRateLimitError(msg);
  }
  throw err;
}

async function toDataUri(url: string): Promise<string> {
  if (url.startsWith("https://") || url.startsWith("data:") || url.startsWith("runway://")) return url;

  const filePath = resolveLocalPath(url);
  if (filePath) {
    const mime = mimeType(extname(filePath));
    if (mime === "application/octet-stream") throw new Error(`unsupported format: ${extname(filePath)}`);
    const buf = await readFile(filePath);
    return `data:${mime};base64,${buf.toString("base64")}`;
  }

  throw new Error(`URI must be https://, data:, runway://, or a local storage URL — got ${url.slice(0, 60)}`);
}

async function toRunwayUri(url: string): Promise<string> {
  if (url.startsWith("https://") || url.startsWith("runway://")) return url;

  const filePath = resolveLocalPath(url);
  if (filePath) {
    const buf = await readFile(filePath);
    const name = basename(filePath);
    const file = await toFile(buf, name);
    const upload = await runway.uploads.createEphemeral({ file });
    return upload.uri;
  }

  throw new Error(`URI must be https://, runway://, or a local storage URL — got ${url.slice(0, 60)}`);
}

export async function imageToVideo(req: ImageToVideoRequest): Promise<RunwayTask> {
  try {
    // Bridge-mode prompt image (array with first + last keyframes). Only
    // valid for seedance2 / veo3.1 / veo3.1_fast / gen3a_turbo; silently
    // dropped for models that only accept a first frame.
    const buildBridgePrompt = async () => {
      const first = await toRunwayUri(req.promptImage);
      const last = await toRunwayUri(req.promptImageEnd!);
      return [
        { uri: first, position: "first" as const },
        { uri: last, position: "last" as const },
      ];
    };
    const wantsBridge = !!req.promptImageEnd;

    if (req.model === "seedance2") {
      const promptImage = wantsBridge
        ? await buildBridgePrompt()
        : [{ uri: await toRunwayUri(req.promptImage), position: "first" as const }];
      const task = await runway.imageToVideo.create({
        model: "seedance2" as "gen4_turbo",
        promptImage,
        promptText: req.promptText,
        ratio: "1280:720",
        duration: req.duration,
      } as any);
      return { id: task.id };
    }
    if (req.model === "veo3.1" || req.model === "veo3.1_fast") {
      const promptImage = wantsBridge
        ? await buildBridgePrompt()
        : await toRunwayUri(req.promptImage);
      const task = await runway.imageToVideo.create({
        model: req.model,
        promptImage,
        promptText: req.promptText,
        ratio: req.ratio as "1280:720",
        duration: req.duration as 4 | 6 | 8,
      });
      return { id: task.id };
    }
    if (req.model === "gen3a_turbo") {
      const promptImage = wantsBridge
        ? await buildBridgePrompt()
        : await toRunwayUri(req.promptImage);
      const task = await runway.imageToVideo.create({
        model: "gen3a_turbo",
        promptImage,
        promptText: req.promptText ?? "",
        // gen3a_turbo only accepts 1280:768 or 768:1280; not exposed in the
        // UI today, so the cast is a placeholder for direct API callers.
        ratio: req.ratio as "1280:768",
        duration: req.duration as 5 | 10,
      });
      return { id: task.id };
    }
    // First-frame-only models below — promptImageEnd is silently dropped.
    if (req.model === "gen4.5") {
      const imageUri = await toRunwayUri(req.promptImage);
      const task = await runway.imageToVideo.create({
        model: "gen4.5",
        promptImage: imageUri,
        promptText: req.promptText ?? "",
        ratio: req.ratio as "1280:720",
        duration: req.duration,
      });
      return { id: task.id };
    }
    if (req.model === "veo3") {
      const imageUri = await toRunwayUri(req.promptImage);
      const task = await runway.imageToVideo.create({
        model: "veo3",
        promptImage: imageUri,
        promptText: req.promptText,
        ratio: req.ratio as "1280:720",
        duration: 8,
      });
      return { id: task.id };
    }
    // gen4_turbo — supports data URIs and ignores promptImageEnd.
    // Some ratios in our schema (1080:1920, 1920:1080) are veo-only; the UI
    // pins gen4_turbo to a 1280:720-family ratio, so the cast is safe.
    const task = await runway.imageToVideo.create({
      promptImage: await toDataUri(req.promptImage),
      promptText: req.promptText,
      ratio: req.ratio as "1280:720",
      duration: req.duration as 5 | 10,
      model: req.model as "gen4_turbo",
    });
    return { id: task.id };
  } catch (err) { rethrowRunway(err); }
}

export async function textToVideo(req: TextToVideoRequest): Promise<RunwayTask> {
  try {
    if (req.model === "seedance2") {
      const task = await runway.textToVideo.create({
        model: "seedance2",
        promptText: req.promptText,
        ratio: req.ratio as "1280:720",
        duration: req.duration,
      } as any);
      return { id: task.id };
    }
    if (req.model === "gen4.5") {
      const task = await runway.textToVideo.create({
        model: "gen4.5",
        promptText: req.promptText,
        ratio: req.ratio as "1280:720",
        duration: req.duration,
      });
      return { id: task.id };
    }
    if (req.model === "veo3.1" || req.model === "veo3.1_fast") {
      const task = await runway.textToVideo.create({
        model: req.model,
        promptText: req.promptText,
        ratio: req.ratio as "1280:720",
        duration: req.duration as 4 | 6 | 8,
      });
      return { id: task.id };
    }
    // veo3
    const task = await runway.textToVideo.create({
      model: "veo3",
      promptText: req.promptText,
      ratio: req.ratio as "1280:720",
      duration: 8,
    });
    return { id: task.id };
  } catch (err) { rethrowRunway(err); }
}

export async function videoToVideo(req: VideoToVideoRequest): Promise<RunwayTask> {
  try {
    if (req.model === "seedance2") {
      const videoUri = await toRunwayUri(req.videoUri);
      const task = await runway.videoToVideo.create({
        model: "seedance2",
        promptVideo: videoUri,
        promptText: req.promptText,
        ratio: "1280:720",
      } as any);
      return { id: task.id };
    }
    const task = await runway.videoToVideo.create({
      videoUri: req.videoUri,
      promptText: req.promptText,
      ratio: req.ratio,
      model: "gen4_aleph",
      references: req.references?.map((uri) => ({ type: "image" as const, uri })),
    });
    return { id: task.id };
  } catch (err) { rethrowRunway(err); }
}

export async function textToImage(req: TextToImageRequest): Promise<RunwayTask> {
  try {
    const refs = await Promise.all(
      (req.referenceImages ?? []).map(async (r) => ({
        uri: await toRunwayUri(r.uri),
        ...(r.tag ? { tag: r.tag } : {}),
        ...(r.subject ? { subject: r.subject } : {}),
      }))
    );
    if (req.model === "gen4_image_turbo") {
      if (refs.length === 0) {
        throw new Error("gen4_image_turbo requires at least one reference image");
      }
      const task = await runway.textToImage.create({
        model: "gen4_image_turbo",
        promptText: req.promptText,
        ratio: req.ratio as "1280:720",
        referenceImages: refs,
      });
      return { id: task.id };
    }
    if (req.model === "gpt_image_2") {
      const task = await runway.textToImage.create({
        model: "gpt_image_2",
        promptText: req.promptText,
        ratio: req.ratio as "auto",
        ...(refs.length ? { referenceImages: refs } : {}),
        ...(req.quality ? { quality: req.quality } : {}),
        ...(req.outputCount ? { outputCount: req.outputCount } : {}),
      });
      return { id: task.id };
    }
    if (req.model === "gemini_image3_pro") {
      const task = await runway.textToImage.create({
        model: "gemini_image3_pro",
        promptText: req.promptText,
        ratio: req.ratio as "1024:1024",
        ...(refs.length ? { referenceImages: refs as any } : {}),
        ...(req.outputCount ? { outputCount: req.outputCount as 1 | 4 } : {}),
      });
      return { id: task.id };
    }
    if (req.model === "gemini_2.5_flash") {
      const task = await runway.textToImage.create({
        model: "gemini_2.5_flash",
        promptText: req.promptText,
        ratio: req.ratio as "1024:1024",
        ...(refs.length ? { referenceImages: refs } : {}),
      });
      return { id: task.id };
    }
    const task = await runway.textToImage.create({
      model: "gen4_image",
      promptText: req.promptText,
      ratio: req.ratio as "1280:720",
      ...(refs.length ? { referenceImages: refs } : {}),
    });
    return { id: task.id };
  } catch (err) { rethrowRunway(err); }
}

export async function actTwo(req: ActTwoRequest): Promise<RunwayTask> {
  try {
    const task = await runway.characterPerformance.create({
      model: "act_two",
      ratio: req.ratio,
      bodyControl: req.bodyControl,
      expressionIntensity: req.expressionIntensity,
      character: { type: "image", uri: req.characterImageUri },
      reference: { type: "video", uri: req.drivingVideoUri },
    });
    return { id: task.id };
  } catch (err) { rethrowRunway(err); }
}

// --- Endpoints not exposed by @runwayml/sdk@2.6.0 ---
// Lip-Sync and Voice-Isolation exist in the REST API but the typed SDK doesn't
// surface them yet. We hit them with raw fetch and rely on the same task-status
// machinery for polling.

async function rawCreate(path: string, body: unknown): Promise<RunwayTask> {
  if (!config.RUNWAYML_API_SECRET) {
    throw new Error("RUNWAYML_API_SECRET not set");
  }
  const res = await fetch(`${RUNWAY_BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.RUNWAYML_API_SECRET}`,
      "X-Runway-Version": "2024-11-06",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    const msg = `runway ${path} failed: ${res.status} ${detail}`;
    if (res.status === 429 || detail.toLowerCase().includes("task limit")) {
      throw new RunwayRateLimitError(msg);
    }
    throw new Error(msg);
  }
  const json = (await res.json()) as { id: string };
  return { id: json.id };
}

const RUNWAY_MAX_DIM = 4000;

async function constrainImage(buf: Buffer): Promise<Buffer> {
  const meta = await sharp(buf).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w <= RUNWAY_MAX_DIM && h <= RUNWAY_MAX_DIM) return buf;
  return sharp(buf)
    .resize({ width: RUNWAY_MAX_DIM, height: RUNWAY_MAX_DIM, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
}

import type { AvatarSummary } from "@mvs/shared";
export type { AvatarSummary };

export async function listAvatars(): Promise<AvatarSummary[]> {
  const results: AvatarSummary[] = [];
  for await (const a of runway.avatars.list({ limit: 50 })) {
    results.push({
      id: a.id,
      name: a.name,
      status: a.status as AvatarSummary["status"],
      imageUri: a.processedImageUri ?? a.referenceImageUri,
      createdAt: a.createdAt,
    });
  }
  return results;
}

export async function createAvatar(imageUrl: string, name: string): Promise<{ avatarId: string }> {
  const filePath = resolveLocalPath(imageUrl);
  let imageUri: string;
  if (filePath) {
    const resized = await constrainImage(await readFile(filePath));
    const file = await toFile(resized, "character.jpg");
    const upload = await runway.uploads.createEphemeral({ file });
    imageUri = upload.uri;
  } else {
    imageUri = await toRunwayUri(imageUrl);
  }
  const avatar = await runway.avatars.create({
    name,
    personality: "A character in a music video.",
    referenceImage: imageUri,
    voice: { type: "runway-live-preset", presetId: "victoria" },
    imageProcessing: "optimize",
  });

  if (avatar.status === "FAILED") {
    throw new Error(`avatar creation failed: ${avatar.failureReason}`);
  }

  if (avatar.status === "PROCESSING") {
    const polled = await pollUntil(
      () => runway.avatars.retrieve(avatar.id),
      (a) => a.status === "READY" || a.status === "FAILED",
      { timeoutMs: 120_000, label: "avatar processing" }
    );
    if (polled.status === "FAILED") {
      throw new Error(`avatar processing failed: ${polled.failureReason}`);
    }
    return { avatarId: polled.id };
  }

  return { avatarId: avatar.id };
}

export async function lipSync(req: LipSyncRequest): Promise<RunwayTask> {
  try {
    const audioUri = await toRunwayUri(req.audioUri);
    const task = await runway.avatarVideos.create({
      model: "gwm1_avatars",
      avatar: { type: "custom", avatarId: req.avatarId },
      speech: { type: "audio", audio: audioUri },
    });
    return { id: task.id };
  } catch (err) { rethrowRunway(err); }
}

export async function voiceIsolation(req: VoiceIsolationRequest): Promise<RunwayTask> {
  try {
    const task = await runway.voiceIsolation.create({
      model: "eleven_voice_isolation",
      audioUri: await toDataUri(req.audioUri),
    });
    return { id: task.id };
  } catch (err) { rethrowRunway(err); }
}

export async function getTask(id: string) {
  return runway.tasks.retrieve(id);
}

export async function deleteTask(id: string) {
  return runway.tasks.delete(id);
}
