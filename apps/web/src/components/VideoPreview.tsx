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
  /** Clip ID currently loaded in each slot. Bookkeeping only — no render impact. */
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

  const loadInto = useCallback((slot: "a" | "b", clip: { id: string; videoUrl: string }) => {
    if (loadedRef.current[slot] === clip.id) return;
    const el = slotEl(slot);
    if (!el) return;
    loadedRef.current[slot] = clip.id;
    el.src = clip.videoUrl;
    el.load();
  }, [slotEl]);

  // Load/swap clips when the active clip changes. Preload next.
  useEffect(() => {
    if (!active) return;
    const back: "a" | "b" = frontSlot === "a" ? "b" : "a";

    if (loadedRef.current[frontSlot] === active.id) {
      // Already loaded on front — nothing to swap.
    } else if (loadedRef.current[back] === active.id) {
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

    if (next && loadedRef.current[back] !== next.id) {
      loadInto(back, next);
    }
    // playhead intentionally omitted — only used for the inline seek above,
    // which we want bound to the active-change moment, not every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, next, frontSlot, slotEl, loadInto, isPlaying]);

  // Keep the front video synced to the playhead during scrubbing/playback.
  useEffect(() => {
    if (!active) return;
    const front = slotEl(frontSlot);
    if (!front) return;
    if (front.readyState >= 1) {
      seekTo(front, active, playhead);
    } else {
      const doSeek = () => seekTo(front, active, playhead);
      front.addEventListener("loadedmetadata", doSeek, { once: true });
    }
  }, [playhead, active, frontSlot, slotEl]);

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

  if (!active) {
    return (
      <div className="preview-empty">
        <div className="label-big">preview</div>
        <div>no clip at playhead</div>
      </div>
    );
  }

  // Both videos are always rendered; only one is visible. Position absolutely
  // so the hidden one doesn't take layout space.
  const slotStyle = (slot: "a" | "b"): React.CSSProperties => ({
    width: "100%",
    height: "100%",
    position: "absolute",
    inset: 0,
    visibility: frontSlot === slot ? "visible" : "hidden",
  });

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <video ref={aRef} muted playsInline style={slotStyle("a")} />
      <video ref={bRef} muted playsInline style={slotStyle("b")} />
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
