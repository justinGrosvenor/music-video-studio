import { z } from "zod";
import { AudioAnalysis } from "./audio.js";

export const Asset = z.object({
  id: z.string(),
  url: z.string(),
  kind: z.enum(["character", "lookbook", "clip"]),
  label: z.string().optional(),
});
export type Asset = z.infer<typeof Asset>;

// Models the user can pick per-clip in the Sidebar. Mirrors the broader
// VideoGenerationModel set in generation.ts but kept narrow here for the UI;
// uncommon models (gen3a_turbo, raw veo3) live in the request schema only.
export const GenerationModel = z.enum([
  "gen4.5",
  "gen4_turbo",
  "seedance2",
  "veo3.1",
  "veo3.1_fast",
]);
export type GenerationModel = z.infer<typeof GenerationModel>;

export const Clip = z.object({
  id: z.string(),
  start: z.number(),
  end: z.number(),
  videoUrl: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  source: z.enum([
    "continue",
    "archetype",
    "generated",
    "textToVideo",
    "lipSync",
    "actTwo",
    "aleph",
  ]),
  model: GenerationModel.optional(),
  /** When source = "archetype": which lookbook image to seed from. */
  archetypeUrl: z.string().optional(),
  /** When source = "continue": enrich prompt with motion from previous clip. */
  continuity: z.boolean().optional(),
  prompt: z.string().optional(),
  /** When source = "generated": prompt for the text-to-image seed step.
   *  Falls back to `prompt` if not set. */
  imagePrompt: z.string().optional(),
  generationTaskId: z.string().optional(),
  /** Last failure reason, kept for the "retry" UX. Cleared on next enqueue. */
  lastError: z.string().optional(),
  status: z.enum(["empty", "queued", "generating", "ready", "failed"]),
});
export type Clip = z.infer<typeof Clip>;

export const Project = z.object({
  id: z.string(),
  songId: z.string(),
  characterAssetId: z.string().optional(),
  lookbook: z.array(z.string()),
  clips: z.array(Clip),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof Project>;

/**
 * Persisted shape for a project snapshot — stored in localStorage and on the
 * server. Every field is optional so a saved project from an older schema
 * version still loads (missing fields fall back to defaults at the call site).
 */
export const ProjectSnapshot = z.object({
  projectId: z.string().nullable().optional(),
  projectName: z.string().nullable().optional(),
  songId: z.string().nullable().optional(),
  songFilename: z.string().nullable().optional(),
  audioUrl: z.string().nullable().optional(),
  analysis: AudioAnalysis.nullable().optional(),
  clips: z.array(Clip).optional(),
  characterImageUrl: z.string().nullable().optional(),
  avatarId: z.string().nullable().optional(),
  avatarName: z.string().nullable().optional(),
  lookbook: z.array(z.string()).optional(),
  zoom: z.number().optional(),
  playhead: z.number().optional(),
});
export type ProjectSnapshot = z.infer<typeof ProjectSnapshot>;
