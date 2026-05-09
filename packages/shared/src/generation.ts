import { z } from "zod";

// Models that produce a video from an image (or, for text-to-video, from a
// prompt alone). Per-model duration / ratio constraints are enforced by the
// scheduler since they overlap awkwardly in the schema.
export const VideoGenerationModel = z.enum([
  "gen4_turbo",
  "gen3a_turbo",
  "gen4.5",
  "veo3",
  "veo3.1",
  "veo3.1_fast",
  "seedance2",
]);
export type VideoGenerationModel = z.infer<typeof VideoGenerationModel>;

export const ImageToVideoRequest = z.object({
  promptImage: z.string().url(),
  promptText: z.string().max(1000).optional(),
  ratio: z
    .enum([
      "1280:720", "720:1280", "1104:832", "832:1104", "960:960", "1584:672",
      "1080:1920", "1920:1080",
    ])
    .default("1280:720"),
  duration: z.number().min(2).max(15).default(5),
  model: VideoGenerationModel.default("gen4_turbo"),
});
export type ImageToVideoRequest = z.infer<typeof ImageToVideoRequest>;

export const TextToVideoRequest = z.object({
  promptText: z.string().min(1).max(3500),
  ratio: z
    .enum([
      "1280:720", "720:1280", "1080:1920", "1920:1080",
      // seedance2 extras
      "992:432", "864:496", "752:560", "640:640", "560:752", "496:864",
      "1470:630", "1112:834", "960:960", "834:1112",
    ])
    .default("1280:720"),
  duration: z.number().min(2).max(15).default(5),
  model: z
    .enum(["gen4.5", "seedance2", "veo3", "veo3.1", "veo3.1_fast"])
    .default("gen4.5"),
});
export type TextToVideoRequest = z.infer<typeof TextToVideoRequest>;

export const VideoToVideoRequest = z.object({
  videoUri: z.string().url(),
  promptText: z.string().min(1).max(3500),
  references: z.array(z.string().url()).max(1).optional(),
  ratio: z
    .enum([
      "1280:720",
      "720:1280",
      "1104:832",
      "832:1104",
      "960:960",
      "1584:672",
      "848:480",
      "640:480",
    ])
    .default("1280:720"),
  model: z.enum(["gen4_aleph", "seedance2"]).default("gen4_aleph"),
});
export type VideoToVideoRequest = z.infer<typeof VideoToVideoRequest>;

// Union of every ratio any text-to-image model accepts. Each model rejects the
// ratios it doesn't support — we don't try to enforce per-model constraints in
// the schema (UI surfaces the right list per model).
export const TextToImageModel = z.enum([
  "gen4_image",
  "gen4_image_turbo",
  "gemini_2.5_flash",
]);
export type TextToImageModel = z.infer<typeof TextToImageModel>;

export const TextToImageRatio = z.enum([
  // gen4_image / gen4_image_turbo
  "1024:1024",
  "1080:1080",
  "1168:880",
  "1360:768",
  "1440:1080",
  "1080:1440",
  "1808:768",
  "1920:1080",
  "1080:1920",
  "2112:912",
  "1280:720",
  "720:1280",
  "720:720",
  "960:720",
  "720:960",
  "1680:720",
  // gemini_2.5_flash (extras not shared with gen4)
  "1344:768",
  "768:1344",
  "1184:864",
  "864:1184",
  "1536:672",
  "832:1248",
  "1248:832",
  "896:1152",
  "1152:896",
]);
export type TextToImageRatio = z.infer<typeof TextToImageRatio>;

export const TextToImageRequest = z.object({
  promptText: z.string().min(1).max(1000),
  ratio: TextToImageRatio.default("1920:1080"),
  referenceImages: z
    .array(z.object({ uri: z.string().url(), tag: z.string().optional() }))
    .max(3)
    .optional(),
  model: TextToImageModel.default("gen4_image"),
});
export type TextToImageRequest = z.infer<typeof TextToImageRequest>;

export const ActTwoRequest = z.object({
  characterImageUri: z.string().url(),
  drivingVideoUri: z.string().url(),
  ratio: z
    .enum(["1280:720", "720:1280", "960:960", "1104:832", "832:1104", "1584:672"])
    .default("1280:720"),
  bodyControl: z.boolean().default(true),
  expressionIntensity: z.number().int().min(1).max(5).default(3),
});
export type ActTwoRequest = z.infer<typeof ActTwoRequest>;

// Lip-Sync and Voice-Isolation are not in the @runwayml/sdk yet (as of v2.6.0).
// They exist in the REST API; we call them via raw fetch in apps/api/src/runway.ts.
export const LipSyncRequest = z.object({
  avatarId: z.string(),
  audioUri: z.string().url(),
});
export type LipSyncRequest = z.infer<typeof LipSyncRequest>;

export const VoiceIsolationRequest = z.object({
  audioUri: z.string().url(),
});
export type VoiceIsolationRequest = z.infer<typeof VoiceIsolationRequest>;
