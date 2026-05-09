import { useMemo, useState } from "react";
import { useStore, MAX_CLIP_LEN } from "../lib/store.js";
import type { Clip, GenerationModel } from "@mvs/shared";
import { enqueueGeneration } from "../lib/scheduler.js";
import { saveClipToServer } from "../lib/api.js";
import { getErrorMessage } from "@mvs/shared";
import { AssetUploader } from "./AssetUploader.js";
import { toast } from "../lib/toast.js";

const SOURCES: Array<{ value: Clip["source"]; label: string; desc: string }> = [
  { value: "continue", label: "Continue from previous clip", desc: "use last frame of prev as init" },
  { value: "archetype", label: "Seed from lookbook", desc: "use a specific lookbook image as the init frame" },
  { value: "generated", label: "Generate fresh image", desc: "text-to-image seed, then image-to-video" },
  { value: "textToVideo", label: "Text-to-video", desc: "prompt → video directly, no seed image" },
  { value: "lipSync", label: "Character sings this section", desc: "Lip Sync · vocal stem" },
  { value: "actTwo", label: "Hero performance shot", desc: "Act-Two · record yourself · ≤30s" },
  { value: "aleph", label: "Restyle existing clip", desc: "Aleph · video-to-video" },
];

// Models for image-to-video paths (continue / archetype / generated).
const IMAGE_TO_VIDEO_MODELS: Array<{ value: GenerationModel; label: string; desc: string }> = [
  { value: "gen4.5", label: "Gen-4.5", desc: "flagship · 2–10s" },
  { value: "gen4_turbo", label: "Gen-4 Turbo", desc: "fast · 5 / 10s" },
  { value: "seedance2", label: "SeedDance 2", desc: "high quality · 5–15s" },
  { value: "veo3.1", label: "Veo 3.1", desc: "Google · 4 / 6 / 8s" },
  { value: "veo3.1_fast", label: "Veo 3.1 Fast", desc: "Google · faster · 4 / 6 / 8s" },
];

// Subset for text-to-video (no image-only models).
const TEXT_TO_VIDEO_MODELS: Array<{ value: GenerationModel; label: string; desc: string }> = [
  { value: "gen4.5", label: "Gen-4.5", desc: "flagship · 2–10s" },
  { value: "seedance2", label: "SeedDance 2", desc: "high quality · 5–15s" },
  { value: "veo3.1", label: "Veo 3.1", desc: "Google · 4 / 6 / 8s" },
  { value: "veo3.1_fast", label: "Veo 3.1 Fast", desc: "faster · 4 / 6 / 8s" },
];

// Aleph (video-to-video) constrains to gen4_aleph or seedance2.
const ALEPH_MODELS: Array<{ value: GenerationModel; label: string; desc: string }> = [
  { value: "gen4_turbo", label: "Gen-4 Aleph", desc: "primary restyle path" },
  { value: "seedance2", label: "SeedDance 2", desc: "alt restyle" },
];

function modelsForSource(source: Clip["source"]): typeof IMAGE_TO_VIDEO_MODELS {
  if (source === "textToVideo") return TEXT_TO_VIDEO_MODELS;
  if (source === "aleph") return ALEPH_MODELS;
  return IMAGE_TO_VIDEO_MODELS;
}

export function Sidebar() {
  const selectedId = useStore((s) => s.selectedClipId);
  const clips = useStore((s) => s.clips);
  const analysis = useStore((s) => s.analysis);
  const lookbook = useStore((s) => s.lookbook);
  const updateClip = useStore((s) => s.updateClip);
  const characterImage = useStore((s) => s.characterImageUrl);
  const avatarId = useStore((s) => s.avatarId);
  const avatarStatus = useStore((s) => s.avatarStatus);
  const splitAtPlayhead = useStore((s) => s.splitAtPlayhead);
  const mergeWithRight = useStore((s) => s.mergeWithRight);
  const songId = useStore((s) => s.songId);
  const audioUrl = useStore((s) => s.audioUrl);
  const [savingClip, setSavingClip] = useState(false);

  const clip = useMemo(() => clips.find((c) => c.id === selectedId) ?? null, [clips, selectedId]);

  if (!clip || !analysis) return null;

  const section = analysis.sections.find((s) => s.start <= clip.start && s.end >= clip.end);
  const sectionLabel = section?.label ?? "section";
  const durationSec = clip.end - clip.start;
  const energy = avgRms(analysis.rmsCurve, clip.start, clip.end, analysis.duration);
  const prompt = clip.prompt ?? "";
  const imagePrompt = clip.imagePrompt ?? "";

  const clipIdx = clips.findIndex((c) => c.id === clip.id);
  const hasPrev = clipIdx > 0 && clips[clipIdx - 1]?.status === "ready";

  const effectiveModel = clip.model ?? "seedance2";
  const showModelPicker = clip.source !== "lipSync" && clip.source !== "actTwo";

  const setSource = (source: Clip["source"]) => updateClip(clip.id, { source });
  const setModel = (model: GenerationModel) => updateClip(clip.id, { model });
  const setPrompt = (value: string) => updateClip(clip.id, { prompt: value });
  const setImagePrompt = (value: string) => updateClip(clip.id, { imagePrompt: value });
  const setContinuity = (on: boolean) => updateClip(clip.id, { continuity: on });

  const onSplit = () => {
    const r = splitAtPlayhead();
    if (!r.ok) toast.warning(`Can't split: ${r.reason}`);
  };

  const onMerge = () => {
    const r = mergeWithRight(clip.id);
    if (!r.ok) toast.warning(`Can't merge: ${r.reason}`);
  };

  const canGenerate = checkCanGenerate(clip, {
    prompt,
    imagePrompt,
    avatarId,
    avatarStatus,
    songId,
    audioUrl,
    lookbook,
    characterImage,
    hasPrev,
  });

  const onGenerate = () => {
    if (!canGenerate.ok) {
      toast.warning(canGenerate.reason);
      return;
    }
    // "generated" and "textToVideo" both don't take an upfront seed image;
    // pass empty here. For others, derive from the lookbook or character.
    const seed =
      clip.source === "generated" || clip.source === "textToVideo"
        ? ""
        : clip.source === "archetype"
          ? clip.archetypeUrl ?? lookbook[0] ?? ""
          : characterImage ?? "";
    enqueueGeneration({
      clipId: clip.id,
      source: clip.source,
      seedImageUrl: seed,
      inputVideoUrl: clip.source === "aleph" ? clip.videoUrl : undefined,
      songId: clip.source === "lipSync" ? songId ?? undefined : undefined,
      audioUrl: clip.source === "lipSync" ? audioUrl ?? undefined : undefined,
      avatarId: clip.source === "lipSync" ? avatarId ?? undefined : undefined,
      clipStart: clip.source === "lipSync" ? clip.start : undefined,
      clipEnd: clip.source === "lipSync" ? clip.end : undefined,
      prompt,
      imagePrompt: clip.source === "generated" ? imagePrompt : undefined,
      duration: durationSec,
      sectionLabel,
      energy,
      model: showModelPicker ? effectiveModel : undefined,
      continuity: clip.source === "continue" ? clip.continuity : undefined,
      referenceImages: clip.source === "generated" ? lookbook.slice(0, 3) : undefined,
    });
  };

  const onSaveClip = async () => {
    if (!clip.videoUrl || clip.status !== "ready") return;
    setSavingClip(true);
    try {
      await saveClipToServer({
        id: `clip-${crypto.randomUUID().slice(0, 8)}`,
        name: prompt?.slice(0, 60) || `${sectionLabel} clip`,
        videoUrl: clip.videoUrl,
        source: clip.source,
        prompt: prompt || null,
        duration: durationSec,
        sectionLabel,
      });
      toast.success("Clip saved to library");
    } catch (err) {
      toast.error(`Save failed: ${getErrorMessage(err)}`);
    } finally {
      setSavingClip(false);
    }
  };

  return (
    <aside className="right">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span className="pill">{sectionLabel}</span>
      </div>
      <div className="meta">
        {durationSec.toFixed(1)}s · {clip.id}
      </div>

      <div className="option-group">
        <div className="label">Region</div>
        <div className="region-actions">
          <SplitButton onSplit={onSplit} />
          <button
            type="button"
            className="btn"
            onClick={onMerge}
            title="merge with the next clip (M)"
          >
            ⇥ Merge right
          </button>
        </div>
      </div>

      <SourcePicker
        clip={clip}
        effectiveModel={effectiveModel}
        showModelPicker={showModelPicker}
        hasPrev={hasPrev}
        lookbook={lookbook}
        onSourceChange={setSource}
        onModelChange={setModel}
        onContinuityChange={setContinuity}
        onUpdateClip={updateClip}
      />

      {clip.source === "generated" ? (
        <>
          <div className="option-group">
            <div className="label">Image prompt</div>
            <textarea
              className="prompt"
              placeholder="anya in a flooded subway, neon reflections, 35mm film grain…"
              value={imagePrompt}
              onChange={(e) => setImagePrompt(e.target.value)}
            />
          </div>
          <div className="option-group">
            <div className="label">Motion prompt (optional)</div>
            <textarea
              className="prompt"
              placeholder="slow dolly-in, water ripples, hair drifts in the wind…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>
        </>
      ) : (
        <div className="option-group">
          <div className="label">Prompt (optional)</div>
          <textarea
            className="prompt"
            placeholder="anya running through neon rain, slow shutter…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>
      )}

      <div className="option-group">
        <div className="label">Audio context (auto)</div>
        <div className="context-card">
          <div className="row"><span>Section</span><span>{sectionLabel}</span></div>
          <div className="row"><span>Energy</span><span>{energy.toFixed(2)}</span></div>
          <div className="row">
            <span>Duration</span>
            <span>
              {durationSec.toFixed(2)}s
              <span className="dim" style={{ marginLeft: 6 }}>/ {MAX_CLIP_LEN}s cap</span>
            </span>
          </div>
        </div>
      </div>

      {clip.status === "failed" && clip.lastError && (
        <div className="error-card">
          <div className="error-title">last attempt failed</div>
          <div className="error-message">{clip.lastError}</div>
        </div>
      )}

      <button
        className="generate-btn"
        onClick={onGenerate}
        disabled={
          clip.status === "queued" ||
          clip.status === "generating" ||
          !canGenerate.ok
        }
        title={canGenerate.ok ? undefined : canGenerate.reason}
      >
        {clip.status === "queued"
          ? "Queued…"
          : clip.status === "generating"
            ? "Generating…"
            : clip.status === "failed"
              ? "Retry"
              : clip.source === "aleph"
                ? "Restyle clip"
                : clip.source === "lipSync"
                  ? "Lip-sync vocal"
                  : clip.status === "ready"
                    ? "Regenerate"
                    : "Generate"}
      </button>

      {clip.status === "ready" && clip.videoUrl && (
        <button
          className="btn save-clip-btn"
          onClick={onSaveClip}
          disabled={savingClip}
        >
          {savingClip ? "Saving…" : "Save to clip library"}
        </button>
      )}
    </aside>
  );
}

type CanGenerate = { ok: true } | { ok: false; reason: string };

function checkCanGenerate(
  clip: Clip,
  ctx: {
    prompt: string;
    imagePrompt: string;
    avatarId: string | null;
    avatarStatus: string;
    songId: string | null;
    audioUrl: string | null;
    lookbook: string[];
    characterImage: string | null;
    hasPrev: boolean;
  },
): CanGenerate {
  if (clip.source === "aleph") {
    if (!clip.videoUrl) return { ok: false, reason: "Aleph needs an existing clip — generate one first" };
    if (!ctx.prompt.trim()) return { ok: false, reason: "Aleph needs a prompt describing the transformation" };
    return { ok: true };
  }
  if (clip.source === "lipSync") {
    if (!ctx.avatarId) {
      if (ctx.avatarStatus === "creating") return { ok: false, reason: "Avatar is being created — hang tight…" };
      if (ctx.avatarStatus === "failed") return { ok: false, reason: "Avatar creation failed — try re-uploading the character image" };
      return { ok: false, reason: "Upload a character image first (Cast panel)" };
    }
    if (!ctx.songId || !ctx.audioUrl) return { ok: false, reason: "Lip-Sync needs a loaded song" };
    return { ok: true };
  }
  if (clip.source === "archetype") {
    if (!(clip.archetypeUrl ?? ctx.lookbook[0])) return { ok: false, reason: "Add a lookbook image first" };
    return { ok: true };
  }
  if (clip.source === "generated" || clip.source === "textToVideo") {
    // No prompt required — generation falls back to the auto-default
    // ("section, energy x, cinematic") when blank.
    return { ok: true };
  }
  if (clip.source === "continue") {
    // Seed comes from the previous clip's last frame; the character image is
    // only a fallback for the very first clip on the timeline.
    if (ctx.hasPrev) return { ok: true };
    if (!ctx.characterImage) {
      return { ok: false, reason: "First clip needs a previous clip or a character image to seed from" };
    }
    return { ok: true };
  }
  if (!ctx.characterImage) return { ok: false, reason: "Upload a character image first" };
  return { ok: true };
}

function SourcePicker({
  clip,
  effectiveModel,
  showModelPicker,
  hasPrev,
  lookbook,
  onSourceChange,
  onModelChange,
  onContinuityChange,
  onUpdateClip,
}: {
  clip: Clip;
  effectiveModel: GenerationModel;
  showModelPicker: boolean;
  hasPrev: boolean;
  lookbook: string[];
  onSourceChange: (source: Clip["source"]) => void;
  onModelChange: (model: GenerationModel) => void;
  onContinuityChange: (on: boolean) => void;
  onUpdateClip: (id: string, patch: Partial<Clip>) => void;
}) {
  return (
    <div className="option-group">
      <div className="label">Source</div>
      <div className="select-wrap">
        <select
          className="select"
          value={clip.source}
          onChange={(e) => onSourceChange(e.target.value as Clip["source"])}
        >
          {SOURCES.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="select-chevron">▾</span>
      </div>
      <div className="select-desc">
        {SOURCES.find((s) => s.value === clip.source)?.desc}
      </div>

      {showModelPicker && (
        <div className="model-picker">
          {modelsForSource(clip.source).map((m) => (
            <button
              key={m.value}
              type="button"
              className={`model-chip${effectiveModel === m.value ? " active" : ""}`}
              onClick={() => onModelChange(m.value)}
              title={m.desc}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      {clip.source === "continue" && hasPrev && (
        <label className="continuity-toggle">
          <input
            type="checkbox"
            checked={clip.continuity ?? false}
            onChange={(e) => onContinuityChange(e.target.checked)}
          />
          <span>Motion continuity</span>
          <span className="select-desc">analyze previous clip to match motion</span>
        </label>
      )}

      {clip.source === "archetype" && (
        <div className="archetype-picker">
          <ArchetypeGrid
            lookbook={lookbook}
            archetypeUrl={clip.archetypeUrl}
            onPick={(url) => onUpdateClip(clip.id, { archetypeUrl: url })}
            onClear={() => onUpdateClip(clip.id, { archetypeUrl: undefined })}
          />
          <div className="archetype-hint">
            Pick a lookbook image or drop a one-off seed for this clip only.
          </div>
        </div>
      )}
    </div>
  );
}

function SplitButton({ onSplit }: { onSplit: () => void }) {
  const splitPreviewTime = useStore((s) => s.splitPreviewTime);
  const playhead = useStore((s) => s.playhead);
  void playhead;
  const splitAt = splitPreviewTime();
  return (
    <button
      type="button"
      className="btn"
      onClick={onSplit}
      disabled={splitAt === null}
      title={splitAt !== null ? `split at ${splitAt.toFixed(2)}s (S)` : "move playhead inside this clip first"}
    >
      ⎟ Split{splitAt !== null ? ` @ ${splitAt.toFixed(2)}s` : ""}
    </button>
  );
}

function ArchetypeGrid({
  lookbook,
  archetypeUrl,
  onPick,
  onClear,
}: {
  lookbook: string[];
  archetypeUrl: string | undefined;
  onPick: (url: string) => void;
  onClear: () => void;
}) {
  // Include the per-clip override (if any) as an extra tile so it's visible
  // in the same grid alongside the lookbook.
  const customUrl = archetypeUrl && !lookbook.includes(archetypeUrl) ? archetypeUrl : null;
  const tiles = customUrl ? [...lookbook, customUrl] : lookbook;
  const effective = archetypeUrl ?? lookbook[0];

  if (tiles.length === 0) {
    return (
      <div className="archetype-grid">
        <AssetUploader className="archetype-tile add" onUploaded={onPick}>
          <span className="tile-add-label">+</span>
        </AssetUploader>
        <div className="archetype-empty">Add lookbook images on the left, or drop a custom seed here.</div>
      </div>
    );
  }

  return (
    <div className="archetype-grid">
      {tiles.map((url) => {
        const selected = effective === url;
        const isCustom = url === customUrl;
        return (
          <div key={url} className={`archetype-tile-wrap${isCustom ? " custom" : ""}`}>
            <button
              type="button"
              className={`archetype-tile${selected ? " selected" : ""}`}
              style={{ backgroundImage: `url(${url})` }}
              onClick={() => onPick(url)}
              aria-label={isCustom ? "select custom seed" : "select archetype"}
            />
            {isCustom && (
              <button
                type="button"
                className="archetype-clear"
                onClick={onClear}
                title="remove custom seed"
                aria-label="remove custom seed"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <AssetUploader className="archetype-tile add" onUploaded={onPick}>
        <span className="tile-add-label">+</span>
      </AssetUploader>
    </div>
  );
}

function avgRms(curve: number[], start: number, end: number, duration: number): number {
  if (!curve.length) return 0;
  const i0 = Math.max(0, Math.floor((start / duration) * curve.length));
  const i1 = Math.min(curve.length, Math.ceil((end / duration) * curve.length));
  if (i1 <= i0) return curve[i0] ?? 0;
  let s = 0;
  for (let i = i0; i < i1; i++) s += curve[i] ?? 0;
  return s / (i1 - i0);
}
