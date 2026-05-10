import { z } from "zod";

export const AvatarSummary = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["PROCESSING", "READY", "FAILED"]),
  imageUri: z.string().nullable(),
  createdAt: z.string(),
});
export type AvatarSummary = z.infer<typeof AvatarSummary>;

export const ProjectMeta = z.object({
  id: z.string(),
  name: z.string(),
  savedAt: z.string(),
  thumbnailUrl: z.string().nullable(),
});
export type ProjectMeta = z.infer<typeof ProjectMeta>;

export const SavedProject = ProjectMeta.extend({
  state: z.record(z.unknown()),
  files: z.array(z.string()),
});
export type SavedProject = z.infer<typeof SavedProject>;

export const RenderEntry = z.object({
  name: z.string(),
  url: z.string(),
  size: z.number(),
  modifiedAt: z.string(),
});
export type RenderEntry = z.infer<typeof RenderEntry>;

export const SavedClip = z.object({
  id: z.string(),
  name: z.string(),
  videoUrl: z.string(),
  source: z.string(),
  prompt: z.string().nullable(),
  duration: z.number(),
  sectionLabel: z.string().nullable(),
  savedAt: z.string(),
});
export type SavedClip = z.infer<typeof SavedClip>;

export const SavedImage = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  /** Where the image came from: "uploaded" | "generated" | external label. */
  source: z.string(),
  /** Text-to-image prompt (only set for generated images). */
  prompt: z.string().nullable(),
  /** Runway model when source = "generated", else null. */
  model: z.string().nullable(),
  savedAt: z.string(),
});
export type SavedImage = z.infer<typeof SavedImage>;
