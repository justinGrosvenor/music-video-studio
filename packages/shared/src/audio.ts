import { z } from "zod";

export const AudioSection = z.object({
  start: z.number(),
  end: z.number(),
  label: z.string(),
});
export type AudioSection = z.infer<typeof AudioSection>;

export const AudioAnalysis = z.object({
  duration: z.number(),
  bpm: z.number(),
  key: z.string(),
  beats: z.array(z.number()),
  downbeats: z.array(z.number()),
  onsets: z.array(z.number()),
  rmsCurve: z.array(z.number()),
  sections: z.array(AudioSection),
});
export type AudioAnalysis = z.infer<typeof AudioAnalysis>;

export const Song = z.object({
  id: z.string(),
  filename: z.string(),
  uploadedAt: z.string(),
  audioUrl: z.string(),
  analysisStatus: z.enum(["pending", "ready", "failed"]),
  analysis: AudioAnalysis.optional(),
});
export type Song = z.infer<typeof Song>;
