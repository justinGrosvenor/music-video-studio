import { join } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { paths, storage } from "./storage.js";
import { config } from "./config.js";
import { runFfmpeg, probeDuration } from "./ffmpeg.js";

export type RenderClip = {
  start: number;
  end: number;
  videoUrl: string;
};

export type RenderRequest = {
  projectId: string;
  audioUrl: string;
  duration: number;
  clips: RenderClip[];
  /** When true, apply a 150ms alpha fade-in/out to each clip. Off by default. */
  fades?: boolean;
};

const FADE_DURATION = 0.15;

/**
 * Stitch a timeline into an MP4. ffmpeg writes to a local file first, then we
 * push to whichever storage backend is configured (local or S3).
 *
 * v1 stub: hard cuts by default. Pass `fades: true` for a 150ms alpha fade
 * at each clip's edges (gentler boundaries; not real crossfades).
 */
export async function renderTimeline(req: RenderRequest): Promise<{ url: string }> {
  await mkdir(paths.RENDERS, { recursive: true });
  const outputName = `${req.projectId}.mp4`;
  const outputPath = join(paths.RENDERS, outputName);

  // Probe each source video so we can time-stretch it into its timeline slot.
  // Without this, sources shorter than their slot freeze on the last frame and
  // sources longer than their slot get cut mid-motion (the "catch-up" feel).
  // Probe failures degrade to no-stretch (the previous behavior).
  const sourceDurations = await Promise.all(
    req.clips.map(async (c) => {
      try {
        return await probeDuration(c.videoUrl);
      } catch (err) {
        console.warn(`render: probe failed for ${c.videoUrl}, skipping stretch`, err);
        return c.end - c.start;
      }
    })
  );

  const filterComplex: string[] = [];
  const inputs: string[] = [];

  inputs.push("-f", "lavfi", "-i", `color=c=black:s=1280x720:r=30:d=${req.duration}`);
  for (const clip of req.clips) inputs.push("-i", clip.videoUrl);
  inputs.push("-i", req.audioUrl);

  let chain = "[0:v]";
  for (let i = 0; i < req.clips.length; i++) {
    const clip = req.clips[i]!;
    const inputIdx = i + 1;
    const tagOut = `v${i + 1}`;
    const slotDur = clip.end - clip.start;
    const srcDur = sourceDurations[i]!;
    // Stretch factor: K > 1 slows the source (fills a longer slot), K < 1
    // speeds it up (fits a shorter slot). Clamp K to a sane range so a
    // garbage probe (1ms) doesn't blow the filter graph up.
    const k = Math.max(0.25, Math.min(8, slotDur / srcDur));

    const baseChain =
      `[${inputIdx}:v]scale=1280:720:force_original_aspect_ratio=decrease,` +
      `pad=1280:720:(ow-iw)/2:(oh-ih)/2,` +
      `setpts=(PTS-STARTPTS)*${k.toFixed(6)}+${clip.start.toFixed(6)}/TB`;

    const fadeChain = req.fades
      ? `,fade=t=in:st=${clip.start}:d=${FADE_DURATION}:alpha=1,` +
        `fade=t=out:st=${Math.max(clip.start, clip.end - FADE_DURATION)}:d=${FADE_DURATION}:alpha=1`
      : "";

    filterComplex.push(`${baseChain}${fadeChain}[c${i}]`);
    filterComplex.push(`${chain}[c${i}]overlay=enable='between(t,${clip.start},${clip.end})'[${tagOut}]`);
    chain = `[${tagOut}]`;
  }

  const audioIdx = req.clips.length + 1;
  const args = [
    ...inputs,
    "-filter_complex",
    filterComplex.join(";"),
    "-map", chain,
    "-map", `${audioIdx}:a`,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-shortest",
    "-y",
    outputPath,
  ];

  await runFfmpeg(args);
  const { publicUrl } = await storage.saveRender(outputPath, outputName, "video/mp4");
  return { url: publicUrl };
}

export async function writeRenderManifest(projectId: string, req: RenderRequest): Promise<void> {
  const path = join(paths.RENDERS, `${projectId}.manifest.json`);
  await writeFile(path, JSON.stringify(req, null, 2));
}

export function renderExists(projectId: string): boolean {
  return config.STORAGE_BACKEND === "local" && existsSync(join(paths.RENDERS, `${projectId}.mp4`));
}
