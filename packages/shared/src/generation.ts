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
  /** Optional second keyframe — when set, the model interpolates between
   *  promptImage (first) and promptImageEnd (last). Only honored by models
   *  that accept a `last` position: seedance2, veo3.1, veo3.1_fast,
   *  gen3a_turbo. Silently ignored by gen4.5 / gen4_turbo / veo3. */
  promptImageEnd: z.string().url().optional(),
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

/** Image-to-video models that accept a `last` keyframe (so a bridge between
 *  neighboring clips can interpolate first → last). */
export const BRIDGE_CAPABLE_MODELS = [
  "seedance2",
  "veo3.1",
  "veo3.1_fast",
  "gen3a_turbo",
] as const;
export type BridgeCapableModel = typeof BRIDGE_CAPABLE_MODELS[number];
export function modelSupportsBridge(model: VideoGenerationModel | undefined): boolean {
  return BRIDGE_CAPABLE_MODELS.includes((model ?? "seedance2") as BridgeCapableModel);
}

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
  "gemini_image3_pro",
  "gpt_image_2",
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
  // gemini_2.5_flash / gemini_image3_pro shared
  "1344:768",
  "768:1344",
  "1184:864",
  "864:1184",
  "1536:672",
  "832:1248",
  "1248:832",
  "896:1152",
  "1152:896",
  // gemini_image3_pro high-res extras
  "2048:2048",
  "1696:2528",
  "2528:1696",
  "1792:2400",
  "2400:1792",
  "1856:2304",
  "2304:1856",
  "1536:2752",
  "2752:1536",
  "3168:1344",
  "4096:4096",
  "3392:5056",
  "5056:3392",
  "3584:4800",
  "4800:3584",
  "3712:4608",
  "4608:3712",
  "3072:5504",
  "5504:3072",
  "6336:2688",
  // gpt_image_2
  "2048:880",
  "1920:1088",
  "1920:1280",
  "1920:1440",
  "1920:1536",
  "1920:1920",
  "1536:1920",
  "1440:1920",
  "1280:1920",
  "1088:1920",
  "2912:1248",
  "2560:1440",
  "2560:1712",
  "2560:1920",
  "2560:2048",
  "2560:2560",
  "2048:2560",
  "1920:2560",
  "1712:2560",
  "1440:2560",
  "3840:1648",
  "3840:2160",
  "3504:2336",
  "3264:2448",
  "3200:2560",
  "2880:2880",
  "2560:3200",
  "2448:3264",
  "2336:3504",
  "2160:3840",
  "auto",
]);
export type TextToImageRatio = z.infer<typeof TextToImageRatio>;

export const TextToImageRefImage = z.object({
  uri: z.string().url(),
  tag: z.string().optional(),
  subject: z.enum(["object", "human"]).optional(),
});

export const TextToImageRequest = z.object({
  promptText: z.string().min(1).max(32000),
  ratio: TextToImageRatio.default("1920:1080"),
  referenceImages: z
    .array(TextToImageRefImage)
    .max(16)
    .optional(),
  model: TextToImageModel.default("gen4_image"),
  quality: z.enum(["low", "medium", "high", "auto"]).optional(),
  outputCount: z.number().int().min(1).max(10).optional(),
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
