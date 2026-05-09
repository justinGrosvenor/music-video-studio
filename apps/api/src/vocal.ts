import { voiceIsolation, getTask } from "./runway.js";
import { readVocalStemUrl, writeVocalStemUrl } from "./storage.js";
import { pollUntil } from "./poll.js";

const inflight = new Map<string, Promise<{ url: string; cached: boolean }>>();

export async function ensureVocalStem(
  songId: string,
  audioUrl: string
): Promise<{ url: string; cached: boolean }> {
  const cached = await readVocalStemUrl(songId);
  if (cached) return { url: cached, cached: true };

  const existing = inflight.get(songId);
  if (existing) return existing;

  const promise = (async () => {
    const task = await voiceIsolation({ audioUri: audioUrl });
    const result = await awaitTask(task.id);
    if (result.status !== "SUCCEEDED" || !result.output?.[0]) {
      const failure = "failure" in result ? String(result.failure) : "no output URL";
      throw new Error(`voice isolation ${result.status}: ${failure}`);
    }
    const url = result.output[0];
    await writeVocalStemUrl(songId, url);
    return { url, cached: false };
  })();

  inflight.set(songId, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(songId);
  }
}

async function awaitTask(id: string, timeoutMs = 5 * 60 * 1000) {
  return pollUntil(
    () => getTask(id),
    (t) => t.status === "SUCCEEDED" || t.status === "FAILED" || t.status === "CANCELLED",
    { timeoutMs, label: "voice-isolation task" }
  );
}
