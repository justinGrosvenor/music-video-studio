import type {
  AudioAnalysis,
  AvatarSummary,
  ImageToVideoRequest,
  VideoToVideoRequest,
  LipSyncRequest,
  TextToImageRequest,
  TextToVideoRequest,
  ProjectMeta,
  SavedProject,
  RenderEntry,
  SavedClip,
  SavedImage,
  Task,
} from "@mvs/shared";
export type { AvatarSummary, ProjectMeta, SavedProject, RenderEntry, SavedClip, SavedImage };

export class ApiError extends Error {
  status: number;
  rateLimited: boolean;
  constructor(status: number, message: string, rateLimited = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.rateLimited = rateLimited;
  }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    let parsed: { error?: string; rateLimited?: boolean } | null = null;
    try { parsed = JSON.parse(text); } catch {}
    const msg = parsed?.error ?? text;
    throw new ApiError(res.status, msg, parsed?.rateLimited === true);
  }
  return res.json() as Promise<T>;
}

export async function uploadSong(file: File): Promise<{ id: string; audioUrl: string; filename: string }> {
  const fd = new FormData();
  fd.append("file", file);
  return jsonOrThrow(await fetch("/api/songs/upload", { method: "POST", body: fd }));
}

export async function uploadImage(file: File): Promise<{ id: string; url: string }> {
  const fd = new FormData();
  fd.append("file", file);
  return jsonOrThrow(await fetch("/api/images/upload", { method: "POST", body: fd }));
}

export async function extractLastFrame(videoUrl: string, time?: number): Promise<{ url: string }> {
  return jsonOrThrow(
    await fetch("/api/videos/extract-last-frame", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ videoUrl, time }),
    })
  );
}

export async function sliceAudio(audioUrl: string, start: number, end: number): Promise<{ url: string }> {
  return jsonOrThrow(
    await fetch("/api/audio/slice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audioUrl, start, end }),
    })
  );
}

export async function ensureVocalStem(audioUrl: string): Promise<{ url: string; cached: boolean }> {
  return jsonOrThrow(
    await fetch("/api/songs/vocal-stem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audioUrl }),
    })
  );
}

export async function getAnalysis(songId: string): Promise<{ status: "pending" | "ready" | "failed"; analysis?: AudioAnalysis; error?: string }> {
  return jsonOrThrow(await fetch(`/api/songs/${songId}/analysis`));
}

export async function pollAnalysis(songId: string, intervalMs = 2000, timeoutMs = 120_000): Promise<AudioAnalysis> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await getAnalysis(songId);
    if (res.status === "ready" && res.analysis) return res.analysis;
    if (res.status === "failed") throw new Error(res.error ?? "analysis failed");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("analysis timed out");
}

export async function listAvatars(): Promise<AvatarSummary[]> {
  const res = await jsonOrThrow<{ avatars: AvatarSummary[] }>(await fetch("/api/avatars"));
  return res.avatars;
}

export async function createAvatar(imageUrl: string, name: string): Promise<{ avatarId: string }> {
  return jsonOrThrow(await fetch("/api/avatars/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ imageUrl, name }),
  }));
}

export async function startImageToVideo(req: ImageToVideoRequest): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/image-to-video", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));
}

export async function startVideoToVideo(req: VideoToVideoRequest): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/video-to-video", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));
}

export async function startLipSync(req: LipSyncRequest): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/lip-sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));
}

export async function startTextToImage(req: TextToImageRequest): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/text-to-image", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));
}

export async function startTextToVideo(req: TextToVideoRequest): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/text-to-video", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));
}

export async function getTask(id: string): Promise<Task> {
  return jsonOrThrow(await fetch(`/api/tasks/${id}`));
}

export async function pollTask(id: string, intervalMs = 2500, timeoutMs = 600_000): Promise<Task> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await getTask(id);
    if (t.status === "SUCCEEDED" || t.status === "FAILED" || t.status === "CANCELLED") return t;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("task timed out");
}

export type RenderRequest = {
  projectId: string;
  audioUrl: string;
  duration: number;
  clips: Array<{ start: number; end: number; videoUrl: string }>;
  fades?: boolean;
};

export async function renderTimeline(req: RenderRequest): Promise<{ url: string }> {
  return jsonOrThrow(await fetch("/api/render", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));
}

// Projects / Library -------------------------------------------------------

export async function listProjects(): Promise<ProjectMeta[]> {
  const res = await jsonOrThrow<{ projects: ProjectMeta[] }>(await fetch("/api/projects"));
  return res.projects;
}

export async function saveProjectToServer(
  id: string,
  name: string,
  state: Record<string, unknown>,
): Promise<ProjectMeta> {
  return jsonOrThrow(await fetch("/api/projects/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, name, state }),
  }));
}

export async function loadProjectFromServer(id: string): Promise<SavedProject> {
  return jsonOrThrow(await fetch(`/api/projects/${id}`));
}

export async function deleteProjectOnServer(id: string): Promise<void> {
  await jsonOrThrow(await fetch(`/api/projects/${id}`, { method: "DELETE" }));
}

export async function listRenders(): Promise<RenderEntry[]> {
  const res = await jsonOrThrow<{ renders: RenderEntry[] }>(await fetch("/api/library/renders"));
  return res.renders;
}

// Clip Library -------------------------------------------------------------

export async function listSavedClips(): Promise<SavedClip[]> {
  const res = await jsonOrThrow<{ clips: SavedClip[] }>(await fetch("/api/clips"));
  return res.clips;
}

export async function saveClipToServer(clip: Omit<SavedClip, "savedAt">): Promise<SavedClip> {
  return jsonOrThrow(await fetch("/api/clips/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(clip),
  }));
}

export async function deleteClipOnServer(id: string): Promise<void> {
  await jsonOrThrow(await fetch(`/api/clips/${id}`, { method: "DELETE" }));
}

// Image Library -----------------------------------------------------------

export async function listSavedImages(): Promise<SavedImage[]> {
  const res = await jsonOrThrow<{ images: SavedImage[] }>(await fetch("/api/library/images"));
  return res.images;
}

export async function saveImageToLibrary(image: Omit<SavedImage, "savedAt">): Promise<SavedImage> {
  return jsonOrThrow(await fetch("/api/library/images/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(image),
  }));
}

export async function deleteImageFromLibrary(id: string): Promise<void> {
  await jsonOrThrow(await fetch(`/api/library/images/${id}`, { method: "DELETE" }));
}
