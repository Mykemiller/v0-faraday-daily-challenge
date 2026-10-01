"use client";
// Faraday Academy — inline narration bar.
//
// A native <audio> element does the work: it inherits the platform's own
// accessibility, background playback and lock-screen behaviour for free. We add
// only what the design asks for — scrub, speed from 0.75x to 2x, and Media
// Session metadata so the lock screen shows the course rather than a bare URL.
// preload="none" so a lesson page costs nothing until the reader presses play.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Narration } from "@/lib/academy/types";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AudioBar({
  narration,
  courseTitle,
  lessonTitle,
  authorName,
  getStartAt,
  onProgress,
}: {
  narration: Narration;
  courseTitle: string;
  lessonTitle: string;
  authorName?: string;
  /** Saved position, read at loadedmetadata — seeking before then is illegal. */
  getStartAt?: () => number;
  onProgress?: (seconds: number) => void;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(narration.duration_seconds ?? 0);
  const [speed, setSpeed] = useState(1);
  const [failed, setFailed] = useState(false);
  const resumed = useRef(false);

  // Lock screen / media keys. Guarded because Media Session is not everywhere.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: lessonTitle,
        artist: authorName ?? "Faraday Academy",
        album: courseTitle,
      });
    } catch {
      /* MediaMetadata unavailable — playback still works. */
    }
  }, [courseTitle, lessonTitle, authorName]);

  const seek = useCallback((to: number) => {
    const el = ref.current;
    if (!el) return;
    el.currentTime = to;
    setCurrent(to);
  }, []);

  if (failed) {
    return (
      <p className="academy-meta px-3 py-2" style={{ border: "1px dashed var(--ac-rule-strong)" }}>
        That recording wouldn&rsquo;t load. The lesson text below is the full narration.
      </p>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center gap-3 px-3 py-2"
      style={{ backgroundColor: "var(--ac-panel)", border: "1px solid var(--ac-rule)" }}
    >
      <audio
        ref={ref}
        src={narration.url}
        preload="none"
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          setDuration(el.duration || narration.duration_seconds || 0);
          // Restore the saved position once, now that seeking is legal.
          if (!resumed.current) {
            resumed.current = true;
            const at = getStartAt?.() ?? 0;
            if (at > 0 && at < (el.duration || Infinity)) {
              el.currentTime = at;
              setCurrent(at);
            }
          }
        }}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          setCurrent(t);
          onProgress?.(t);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setFailed(true)}
      />

      <button
        type="button"
        onClick={() => {
          const el = ref.current;
          if (!el) return;
          if (el.paused) void el.play()?.catch(() => setFailed(true));
          else el.pause();
        }}
        className="px-3 py-1.5 text-sm font-medium"
        style={{ backgroundColor: "var(--ac-forest)", color: "var(--ac-bg)" }}
      >
        {/* Label carries the state in words; the glyph is decorative. */}
        <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
        <span className="sr-only">{playing ? "Pause narration" : "Play narration"}</span>
      </button>

      <label className="flex min-w-[10rem] flex-1 items-center gap-2">
        <span className="sr-only">Seek within the narration</span>
        <input
          type="range"
          min={0}
          max={Math.max(duration, 1)}
          step={1}
          value={Math.min(current, duration || current)}
          onChange={(e) => seek(Number(e.currentTarget.value))}
          className="w-full"
          aria-valuetext={`${clock(current)} of ${clock(duration)}`}
        />
      </label>

      <span className="academy-meta tabular-nums">
        {clock(current)} / {clock(duration)}
      </span>

      <label className="flex items-center gap-1">
        <span className="sr-only">Playback speed</span>
        <select
          value={speed}
          onChange={(e) => {
            const v = Number(e.currentTarget.value);
            setSpeed(v);
            if (ref.current) ref.current.playbackRate = v;
          }}
          className="academy-meta bg-transparent px-1 py-0.5"
          style={{ border: "1px solid var(--ac-rule-strong)", color: "var(--ac-muted)" }}
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
