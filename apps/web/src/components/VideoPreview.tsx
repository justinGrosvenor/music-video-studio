import { useEffect, useRef, useState, useCallback } from "react";
import { useStore } from "../lib/store.js";
import type { Clip } from "@mvs/shared";

/**
 * Double-buffered video preview. Two <video> elements alternate so the next
 * clip can preload while the current one plays — no black flash at boundaries.
 *
 * Visibility is driven by React state (`frontSlot`) rather than imperative
 * `style.display` mutations: the latter conflicts with React's style prop and
 * leaves the DOM in a state React can stomp on a later render.
 */
export function VideoPreview() {
  const aRef = useRef<HTMLVideoElement>(null);
  const bRef = useRef<HTMLVideoElement>(null);
  const [frontSlot, setFrontSlot] = useState<"a" | "b">("a");
  /** Composite key (id + url) loaded in each slot. Tracks both so a rehosted
   *  URL triggers a reload even though the clip ID stays the same. */
  const loadedRef = useRef<{ a: string | null; b: string | null }>({ a: null, b: null });

  const clips = useStore((s) => s.clips);
  const playhead = useStore((s) => s.playhead);
  const isPlaying = useStore((s) => s.isPlaying);

  const readyClips = clips.filter((c): c is Clip & { videoUrl: string } =>
    c.status === "ready" && !!c.videoUrl
  );

  const active = readyClips.find((c) => playhead >= c.start && playhead < c.end) ?? null;
  const activeIdx = active ? readyClips.indexOf(active) : -1;
  const next = activeIdx >= 0 ? readyClips[activeIdx + 1] ?? null : null;

  const slotEl = useCallback((slot: "a" | "b") => slot === "a" ? aRef.current : bRef.current, []);

  const slotKey = (clip: { id: string; videoUrl: string }) => `${clip.id}\0${clip.videoUrl}`;

  const loadInto = useCallback((slot: "a" | "b", clip: { id: string; videoUrl: string }) => {
    const key = slotKey(clip);
    if (loadedRef.current[slot] === key) return;
    const el = slotEl(slot);
    if (!el) return;
    loadedRef.current[slot] = key;
    el.src = clip.videoUrl;
    el.load();
  }, [slotEl]);

  // Load/swap clips when the active clip changes. Preload next.
  useEffect(() => {
    if (!active) return;
    const back: "a" | "b" = frontSlot === "a" ? "b" : "a";

    const activeKey = slotKey(active);
    if (loadedRef.current[frontSlot] === activeKey) {
      // Already loaded on front — but may be ended from a previous play.
      const front = slotEl(frontSlot);
      if (front) {
        seekTo(front, active, playhead);
        if (isPlaying) front.play().catch(() => {});
      }
    } else if (loadedRef.current[back] === activeKey) {
      // The back slot is preloaded with the new active clip — promote it.
      const oldFront = slotEl(frontSlot);
      const newFront = slotEl(back);
      oldFront?.pause();
      // Reset the new-front to the right time before it becomes visible. The
      // stored element may be parked at its previous `ended` frame (often a
      // black fade-out for Gen-4/Seedance), which would otherwise flash on
      // re-show.
      if (newFront) {
        seekTo(newFront, active, playhead);
        if (isPlaying) newFront.play().catch(() => {});
      }
      setFrontSlot(back);
    } else {
      // Cold load into the current front slot.
      loadInto(frontSlot, active);
    }

    if (next && loadedRef.current[back] !== slotKey(next)) {
      loadInto(back, next);
    }
    // playhead intentionally omitted — only used for the inline seek above,
    // which we want bound to the active-change moment, not every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, next, frontSlot, slotEl, loadInto, isPlaying]);

  // Sync video to playhead only when scrubbing (paused). During playback the
  // video runs on its own clock — constant seeking causes jitter.
  useEffect(() => {
    if (!active || isPlaying) return;
    const front = slotEl(frontSlot);
    if (!front) return;
    if (front.readyState >= 1) {
      seekTo(front, active, playhead);
    } else {
      const doSeek = () => seekTo(front, active, playhead);
      front.addEventListener("loadedmetadata", doSeek, { once: true });
    }
  }, [playhead, active, frontSlot, slotEl, isPlaying]);

  // Play/pause the front element.
  useEffect(() => {
    const front = slotEl(frontSlot);
    if (!front || !active) return;
    if (isPlaying) {
      if (front.ended) front.currentTime = 0;
      front.play().catch(() => {});
    } else {
      front.pause();
    }
  }, [isPlaying, active, frontSlot, slotEl]);

  const containerRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  if (!active) {
    return (
      <div className="preview-empty">
        <div className="label-big">preview</div>
        <div>no clip at playhead</div>
      </div>
    );
  }

  const slotStyle = (slot: "a" | "b"): React.CSSProperties => ({
    width: "100%",
    height: "100%",
    position: "absolute",
    inset: 0,
    visibility: frontSlot === slot ? "visible" : "hidden",
  });

  return (
    <div ref={containerRef} className="preview-container">
      <video ref={aRef} muted playsInline style={slotStyle("a")} />
      <video ref={bRef} muted playsInline style={slotStyle("b")} />
      <button
        type="button"
        className="preview-fullscreen"
        onClick={toggleFullscreen}
        title="Toggle fullscreen"
        aria-label="toggle fullscreen"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
        </svg>
      </button>
    </div>
  );
}

function seekTo(el: HTMLVideoElement, clip: { start: number; end: number }, playhead: number) {
  const clipDur = clip.end - clip.start;
  const vidDur = el.duration;
  if (!vidDur || !clipDur) return;
  const frac = Math.max(0, Math.min(1, (playhead - clip.start) / clipDur));
  const target = Math.min(frac * vidDur, vidDur - 0.01);
  if (Math.abs(el.currentTime - target) > 0.15) {
    el.currentTime = target;
  }
}
