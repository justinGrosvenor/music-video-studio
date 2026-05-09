import { AudioAnalysis } from "@mvs/shared";
import { config } from "./config.js";
import { readAnalysis, writeAnalysis } from "./storage.js";

type ModalResponse = {
  duration: number;
  bpm: number;
  key: string;
  beats: number[];
  downbeats: number[];
  onsets: number[];
  rms_curve: number[];
  sections: Array<{ start: number; end: number; label: string }>;
};

export async function analyzeFromUrl(songId: string, audioUrl: string): Promise<AudioAnalysis> {
  const cached = await readAnalysis(songId);
  if (cached) return cached;

  if (!config.MODAL_AUDIO_URL) {
    throw new Error("MODAL_AUDIO_URL not configured — deploy modal/audio_analysis.py and set the env var");
  }

  const res = await fetch(config.MODAL_AUDIO_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: audioUrl }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`modal analysis failed: ${res.status} ${detail}`);
  }
  const raw = (await res.json()) as ModalResponse;

  const analysis: AudioAnalysis = {
    duration: raw.duration,
    bpm: raw.bpm,
    key: raw.key,
    beats: raw.beats,
    downbeats: raw.downbeats,
    onsets: raw.onsets,
    rmsCurve: raw.rms_curve,
    sections: raw.sections,
  };

  await writeAnalysis(songId, analysis);
  return analysis;
}
