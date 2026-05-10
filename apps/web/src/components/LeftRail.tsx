import { useState, useCallback, useEffect } from "react";
import { useStore } from "../lib/store.js";
import {
  createAvatar,
  listAvatars,
  startTextToImage,
  pollTask,
  saveImageToLibrary,
  type AvatarSummary,
} from "../lib/api.js";
import { downloadFromUrl } from "../lib/download.js";
import { AssetUploader } from "./AssetUploader.js";
import { toast } from "../lib/toast.js";
import { getErrorMessage, type TextToImageModel, type TextToImageRatio } from "@mvs/shared";

const TEXT_TO_IMAGE_MODELS: { value: TextToImageModel; label: string; hint: string }[] = [
  { value: "gen4_image", label: "Gen-4 Image", hint: "high quality, references optional" },
  { value: "gen4_image_turbo", label: "Gen-4 Turbo", hint: "fast, cheaper, references required" },
  { value: "gemini_2.5_flash", label: "Nano Banana", hint: "Google Gemini 2.5 Flash, references optional" },
];

// Per-model ratio sets — Runway rejects mismatches, so we constrain in the UI.
const GEN4_RATIOS: TextToImageRatio[] = [
  "1920:1080", "1080:1920", "1280:720", "720:1280", "1024:1024", "1080:1080",
  "1360:768", "1168:880", "1440:1080", "1080:1440", "1808:768", "2112:912",
  "720:720", "960:720", "720:960", "1680:720",
];
const GEMINI_RATIOS: TextToImageRatio[] = [
  "1024:1024", "1344:768", "768:1344", "1184:864", "864:1184",
  "1536:672", "832:1248", "1248:832", "896:1152", "1152:896",
];

function ratiosFor(model: TextToImageModel): TextToImageRatio[] {
  return model === "gemini_2.5_flash" ? GEMINI_RATIOS : GEN4_RATIOS;
}

const LOOKBOOK_MAX = 6;

type CastMode = "idle" | "browse";

export function LeftRail() {
  const character = useStore((s) => s.characterImageUrl);
  const setCharacter = useStore((s) => s.setCharacter);
  const setAvatarId = useStore((s) => s.setAvatarId);
  const setAvatarName = useStore((s) => s.setAvatarName);
  const setAvatarStatus = useStore((s) => s.setAvatarStatus);
  const pickAvatar = useStore((s) => s.pickAvatar);
  const avatarId = useStore((s) => s.avatarId);
  const avatarName = useStore((s) => s.avatarName);
  const avatarStatus = useStore((s) => s.avatarStatus);
  const avatarError = useStore((s) => s.avatarError);
  const lookbook = useStore((s) => s.lookbook);
  const addLookbook = useStore((s) => s.addLookbook);
  const removeLookbook = useStore((s) => s.removeLookbook);
  const replaceLookbookUrl = useStore((s) => s.replaceLookbookUrl);
  const analysis = useStore((s) => s.analysis);

  const [lookbookStatus, setLookbookStatus] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [mode, setMode] = useState<CastMode>("idle");
  const [existingAvatars, setExistingAvatars] = useState<AvatarSummary[] | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);

  const avatarLoading = avatarStatus === "creating";
  const hasAvatar = !!avatarId && avatarStatus === "ready";

  const openBrowse = useCallback(() => {
    setMode("browse");
    setLoadingList(true);
    listAvatars()
      .then((a) => setExistingAvatars(a))
      .catch(() => setExistingAvatars([]))
      .finally(() => setLoadingList(false));
  }, []);

  const onImageUploaded = useCallback((url: string) => {
    setCharacter(url);
    setMode("idle");
  }, [setCharacter]);

  const onCreateAvatar = useCallback(() => {
    if (!character || !nameInput.trim()) return;
    const name = nameInput.trim();
    setAvatarStatus("creating");
    setAvatarName(name);
    createAvatar(character, name)
      .then(({ avatarId }) => {
        setAvatarId(avatarId);
        setNameInput("");
        toast.success(`Avatar "${name}" created`);
      })
      .catch((err) => {
        const msg = getErrorMessage(err).slice(0, 80);
        setAvatarStatus("failed", msg);
        toast.error(`Avatar creation failed: ${msg}`);
      });
  }, [character, nameInput, setAvatarStatus, setAvatarName, setAvatarId]);

  const onPickExisting = useCallback((a: AvatarSummary) => {
    pickAvatar(a.id, a.name, a.imageUri);
    setMode("idle");
    setNameInput("");
  }, [pickAvatar]);

  const onClear = useCallback(() => {
    setCharacter(null);
    setNameInput("");
    setMode("idle");
  }, [setCharacter]);

  useEffect(() => {
    if (avatarName && !nameInput) setNameInput(avatarName);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const needsName = !!character && !avatarId && !avatarLoading && mode === "idle";
  const canCreate = !!character && !!nameInput.trim() && !avatarLoading;

  const readyAvatars = existingAvatars?.filter((a) => a.status === "READY") ?? [];

  return (
    <aside className="left">
      <div className="section">
        <div className="section-header">
          <span className="label">Cast</span>
          {(character || hasAvatar) && (
            <button type="button" className="add" onClick={onClear}>clear</button>
          )}
        </div>

        {mode === "browse" ? (
          <AvatarPicker
            avatars={readyAvatars}
            loading={loadingList}
            currentId={avatarId}
            onPick={onPickExisting}
            onNew={() => setMode("idle")}
          />
        ) : (
          <>
            <AssetUploader
              className={`cast-card${avatarLoading ? " loading" : ""}`}
              onUploaded={onImageUploaded}
            >
              <div className="thumb-wrap">
                {character ? (
                  <img src={character} className="thumb" alt="" />
                ) : (
                  <div className="thumb placeholder" />
                )}
                {avatarLoading && (
                  <div className="thumb-spinner">
                    <svg viewBox="0 0 24 24" width="20" height="20">
                      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="50 20" />
                    </svg>
                  </div>
                )}
                {hasAvatar && !avatarLoading && (
                  <div className="thumb-badge" title="Avatar ready" />
                )}
              </div>
              <div className="cast-info">
                <div className="cast-name">
                  {avatarLoading
                    ? "Creating avatar…"
                    : avatarName ?? (character ? "Unnamed" : "Drop or click")}
                </div>
                <div className="cast-role">
                  {character
                    ? avatarLoading
                      ? "Building avatar for lip-sync…"
                      : avatarStatus === "failed"
                        ? avatarError ?? "Avatar creation failed"
                        : hasAvatar
                          ? "Avatar ready"
                          : "Name your character below"
                    : "image · the singer"}
                </div>
              </div>
            </AssetUploader>

            {needsName && (
              <div className="cast-name-form">
                <input
                  type="text"
                  className="cast-name-input"
                  placeholder="Character name…"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") onCreateAvatar(); }}
                  autoFocus
                />
                <button
                  type="button"
                  className="btn primary"
                  disabled={!canCreate}
                  onClick={onCreateAvatar}
                >
                  Create
                </button>
              </div>
            )}

            {avatarStatus === "failed" && (
              <div className="cast-error">
                {avatarError ?? "Failed"} —{" "}
                <button type="button" className="add" onClick={onCreateAvatar}>retry</button>
              </div>
            )}

            {!character && !avatarLoading && (
              <button type="button" className="cast-alt-action" onClick={openBrowse}>
                or load an existing character
              </button>
            )}

            {hasAvatar && (
              <button type="button" className="cast-alt-action" onClick={openBrowse}>
                switch character
              </button>
            )}
          </>
        )}
      </div>

      <div className="section">
        <div className="section-header">
          <span className="label">Lookbook</span>
          <span className="dim" style={{ fontSize: 11 }}>
            {lookbook.length}/{LOOKBOOK_MAX}
          </span>
        </div>
        <div className="lookbook">
          {lookbook.map((url) => (
            <div key={url} className="tile filled" style={{ backgroundImage: `url(${url})` }}>
              <button
                type="button"
                className="tile-download"
                onClick={(e) => {
                  e.stopPropagation();
                  void downloadFromUrl(url, url.split("/").pop()?.split("?")[0] || "image.png");
                }}
                title="download"
                aria-label="download tile"
              >
                ↓
              </button>
              <button
                type="button"
                className="tile-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  removeLookbook(url);
                }}
                title="remove"
                aria-label="remove tile"
              >
                ×
              </button>
            </div>
          ))}
          {lookbook.length < LOOKBOOK_MAX && (
            <AssetUploader
              className="tile add"
              onUploaded={(url) => {
                addLookbook(url);
                // Save to the image library so uploads are browsable alongside
                // generated images. The server rehosts external URLs into
                // /storage/images; if the saved URL differs (rehost happened
                // or path normalized), swap the lookbook entry to match so
                // we don't keep pointing at the original.
                const fname = url.split("/").pop()?.split("?")[0] || "image";
                void saveImageToLibrary({
                  id: `img-${crypto.randomUUID().slice(0, 8)}`,
                  name: fname,
                  url,
                  source: "uploaded",
                  prompt: null,
                  model: null,
                })
                  .then((saved) => {
                    if (saved.url !== url) replaceLookbookUrl(url, saved.url);
                  })
                  .catch((err) => console.warn("save uploaded image to library failed", err));
              }}
              onStatus={setLookbookStatus}
            >
              <span className="tile-add-label">{lookbookStatus ?? "+"}</span>
            </AssetUploader>
          )}
          {Array.from({ length: Math.max(0, 3 - lookbook.length - 1) }).map((_, i) => (
            <div key={`ph-${i}`} className="tile placeholder" />
          ))}
        </div>
        <div className="lookbook-actions">
          <button
            type="button"
            className="add"
            onClick={() => setShowGenerator((s) => !s)}
            disabled={lookbook.length >= LOOKBOOK_MAX}
            title={lookbook.length >= LOOKBOOK_MAX ? "lookbook full" : "generate an image"}
          >
            {showGenerator ? "close" : "generate"}
          </button>
        </div>
        {showGenerator && (
          <ImageGenerator
            lookbook={lookbook}
            onDone={(url) => {
              addLookbook(url);
              setShowGenerator(false);
            }}
            onRehosted={replaceLookbookUrl}
          />
        )}
      </div>

      {analysis && (
        <div className="section">
          <div className="section-header">
            <span className="label">Audio analysis</span>
          </div>
          <div className="context-card">
            <div className="row"><span>Sections</span><span>{analysis.sections.length}</span></div>
            <div className="row"><span>BPM</span><span>{analysis.bpm.toFixed(1)}</span></div>
            <div className="row"><span>Key</span><span>{analysis.key}</span></div>
            <div className="row"><span>Beats</span><span>{analysis.beats.length}</span></div>
          </div>
        </div>
      )}
    </aside>
  );
}

function ImageGenerator({
  lookbook,
  onDone,
  onRehosted,
}: {
  lookbook: string[];
  onDone: (url: string) => void;
  onRehosted: (oldUrl: string, newUrl: string) => void;
}) {
  const [model, setModel] = useState<TextToImageModel>("gen4_image");
  const [ratio, setRatio] = useState<TextToImageRatio>("1920:1080");
  const [prompt, setPrompt] = useState("");
  const [useRefs, setUseRefs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);

  const ratios = ratiosFor(model);
  // Snap ratio to a value the chosen model supports.
  useEffect(() => {
    if (!ratios.includes(ratio)) setRatio(ratios[0]!);
  }, [model]); // eslint-disable-line react-hooks/exhaustive-deps

  const turboNeedsRefs = model === "gen4_image_turbo";
  const refsAvailable = lookbook.length > 0;
  const effectiveUseRefs = useRefs || turboNeedsRefs;
  const canGenerate =
    !busy &&
    prompt.trim().length > 0 &&
    (!turboNeedsRefs || refsAvailable);

  const onGenerate = useCallback(async () => {
    if (!canGenerate) return;
    setBusy(true);
    setError(null);
    setProgressLabel("queued");
    try {
      const referenceImages = effectiveUseRefs && refsAvailable
        ? lookbook.slice(0, 3).map((uri) => ({ uri }))
        : undefined;
      const { id } = await startTextToImage({
        promptText: prompt.trim(),
        model,
        ratio,
        ...(referenceImages ? { referenceImages } : {}),
      });
      setProgressLabel("generating…");
      const task = await pollTask(id);
      if (task.status !== "SUCCEEDED" || !task.output?.[0]) {
        throw new Error(task.error ?? `task ${task.status.toLowerCase()}`);
      }
      const imageUrl = task.output[0];
      onDone(imageUrl);
      toast.success("Image added to lookbook");
      setPrompt("");

      // Auto-save into the image library so it's reusable across projects
      // and downloadable from there. The server rehosts external (Runway)
      // URLs into /storage/images/<id>/; on success swap the lookbook entry
      // to the durable URL so it doesn't rot when Runway expires the link.
      void saveImageToLibrary({
        id: `img-${crypto.randomUUID().slice(0, 8)}`,
        name: prompt.trim().slice(0, 60),
        url: imageUrl,
        source: "generated",
        prompt: prompt.trim(),
        model,
      })
        .then((saved) => {
          if (saved.url !== imageUrl) onRehosted(imageUrl, saved.url);
        })
        .catch((err) => console.warn("auto-save image to library failed", err));
    } catch (err) {
      const msg = getErrorMessage(err).slice(0, 140);
      setError(msg);
      toast.error(`Generation failed: ${msg}`);
    } finally {
      setBusy(false);
      setProgressLabel(null);
    }
  }, [canGenerate, effectiveUseRefs, refsAvailable, lookbook, prompt, model, ratio, onDone]);

  return (
    <div className="image-generator">
      <textarea
        className="prompt"
        placeholder="Describe the image…"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        disabled={busy}
      />
      <div className="image-generator-row">
        <select
          className="select"
          value={model}
          onChange={(e) => setModel(e.target.value as TextToImageModel)}
          disabled={busy}
        >
          {TEXT_TO_IMAGE_MODELS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        <select
          className="select"
          value={ratio}
          onChange={(e) => setRatio(e.target.value as TextToImageRatio)}
          disabled={busy}
        >
          {ratios.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
      <label className="continuity-toggle">
        <input
          type="checkbox"
          checked={effectiveUseRefs && refsAvailable}
          onChange={(e) => setUseRefs(e.target.checked)}
          disabled={busy || turboNeedsRefs || !refsAvailable}
        />
        <span>
          Use lookbook as references
          {turboNeedsRefs && <span className="dim"> (required for Turbo)</span>}
          {!refsAvailable && <span className="dim"> (no images yet)</span>}
          {refsAvailable && effectiveUseRefs && (
            <span className="dim"> ({Math.min(3, lookbook.length)} sent)</span>
          )}
        </span>
      </label>
      {turboNeedsRefs && !refsAvailable && (
        <div className="cast-error">Turbo needs at least one lookbook image. Upload one or pick another model.</div>
      )}
      {error && <div className="cast-error">{error}</div>}
      <button
        type="button"
        className="btn primary"
        disabled={!canGenerate}
        onClick={onGenerate}
      >
        {busy ? (progressLabel ?? "working…") : "Generate"}
      </button>
    </div>
  );
}

function AvatarPicker({
  avatars,
  loading,
  currentId,
  onPick,
  onNew,
}: {
  avatars: AvatarSummary[];
  loading: boolean;
  currentId: string | null;
  onPick: (a: AvatarSummary) => void;
  onNew: () => void;
}) {
  return (
    <div className="avatar-picker">
      <div className="avatar-picker-head">
        <span className="avatar-picker-title">Select a character</span>
        <button type="button" className="add" onClick={onNew}>
          new
        </button>
      </div>
      {loading ? (
        <div className="avatar-picker-msg">Loading…</div>
      ) : !avatars.length ? (
        <div className="avatar-picker-msg">
          No avatars yet.{" "}
          <button type="button" className="add" onClick={onNew}>
            Create one
          </button>
        </div>
      ) : (
        <div className="avatar-list">
          {avatars.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`avatar-item${a.id === currentId ? " selected" : ""}`}
              onClick={() => onPick(a)}
            >
              {a.imageUri ? (
                <img src={a.imageUri} className="avatar-item-thumb" alt="" />
              ) : (
                <div className="avatar-item-thumb placeholder" />
              )}
              <div className="avatar-item-info">
                <div className="avatar-item-name">{a.name}</div>
                <div className="avatar-item-date">
                  {new Date(a.createdAt).toLocaleDateString()}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
