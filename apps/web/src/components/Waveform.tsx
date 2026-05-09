import { useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";

type Props = {
  audioUrl: string;
  pxPerSec?: number;
  onReady?: (ws: WaveSurfer) => void;
  onTime?: (t: number) => void;
  onPlay?: () => void;
  onPause?: () => void;
};

export function Waveform({ audioUrl, pxPerSec, onReady, onTime, onPlay, onPause }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const onReadyRef = useRef(onReady);
  const onTimeRef = useRef(onTime);
  const onPlayRef = useRef(onPlay);
  const onPauseRef = useRef(onPause);
  onReadyRef.current = onReady;
  onTimeRef.current = onTime;
  onPlayRef.current = onPlay;
  onPauseRef.current = onPause;

  useEffect(() => {
    if (!containerRef.current) return;
    const style = getComputedStyle(document.documentElement);
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: style.getPropertyValue("--waveform").trim() || "#4a5263",
      progressColor: style.getPropertyValue("--waveform-played").trim() || "#7c5cff",
      cursorColor: style.getPropertyValue("--warm").trim() || "#ff7a59",
      cursorWidth: 1,
      height: 80,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      normalize: true,
      interact: true,
      autoScroll: false,
      hideScrollbar: true,
      fillParent: true,
    });
    wsRef.current = ws;
    void ws.load(audioUrl);
    ws.on("ready", () => onReadyRef.current?.(ws));
    ws.on("audioprocess", () => onTimeRef.current?.(ws.getCurrentTime()));
    ws.on("seeking", () => onTimeRef.current?.(ws.getCurrentTime()));
    ws.on("play", () => onPlayRef.current?.());
    ws.on("pause", () => onPauseRef.current?.());
    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, [audioUrl]);

  // Apply zoom whenever pxPerSec changes. WaveSurfer has its own ready-gate;
  // safest to defer the zoom call until after the ready event has fired.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !pxPerSec || pxPerSec <= 0) return;
    const apply = () => {
      try {
        ws.zoom(pxPerSec);
      } catch {
        /* ignore — duration not ready yet */
      }
    };
    if (ws.getDuration() > 0) apply();
    else ws.once("ready", apply);
  }, [pxPerSec]);

  return <div ref={containerRef} style={{ width: "100%", height: 80 }} />;
}
