import { useEffect, useRef, useState } from "react";
import { Download, Pause, Play, RotateCcw, RotateCw, Square } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { api, onMpvClosed, onMpvError, onMpvMessage } from "../api/client";
import Timeline from "./Timeline";
import type { MpvMessage } from "../api/types";
import { useStore } from "../lib/store";

type Status = "idle" | "loading" | "playing" | "error";

const SPEEDS = [0.5, 1, 2, 4, 8];

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toUnix(local: string): number {
  return Math.floor(new Date(local).getTime() / 1000);
}

function fmt(seconds: number | null): string {
  if (seconds == null || Number.isNaN(seconds)) return "--:--";
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

const STATUS_STYLES: Record<Status, string> = {
  idle: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  loading: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  playing: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  error: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

export default function PlayerSpike({ camera }: { camera: string }) {
  const setError = useStore((s) => s.setError);

  const now = new Date();
  const [start, setStart] = useState(toLocalInput(new Date(now.getTime() - 3600_000)));
  const [end, setEnd] = useState(toLocalInput(now));
  const [speed, setSpeed] = useState(1);

  const [status, setStatus] = useState<Status>("idle");
  const [codec, setCodec] = useState<string | null>(null);
  const [hwdec, setHwdec] = useState<string | null>(null);
  const [timePos, setTimePos] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    const pushLog = (line: string) => setLog((prev) => [...prev.slice(-40), line]);

    const handle = (m: MpvMessage) => {
      if (m.event === "property-change") {
        const { name, data } = m;
        if (name === "video-codec" && typeof data === "string") setCodec(data);
        if (name === "hwdec-current" && typeof data === "string") setHwdec(data);
        if (name === "time-pos" && typeof data === "number") setTimePos(data);
        if (name === "duration" && typeof data === "number") setDuration(data);
        if (name === "pause" && typeof data === "boolean") setPaused(data);
        if (name === "core-idle" && typeof data === "boolean" && !data) setStatus("playing");
      } else if (m.event === "file-loaded") {
        setStatus("playing");
        pushLog("file-loaded");
      } else if (m.event === "end-file") {
        pushLog(`end-file (${m.reason ?? "?"})`);
      } else if (m.event) {
        pushLog(String(m.event));
      } else if (m.raw) {
        pushLog(m.raw);
      }
    };

    const unlisteners = [
      onMpvMessage(handle),
      onMpvError((m) => {
        setStatus("error");
        setLastError(`mpv could not decode/open the stream (reason: ${m.reason ?? "error"}).`);
      }),
      onMpvClosed(() => {
        setStatus("idle");
        pushLog("player window closed");
      }),
    ];
    return () => {
      unlisteners.forEach((p) => void p.then((un) => un()));
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [log]);

  const play = async (s: number, e: number) => {
    setStatus("loading");
    setLastError(null);
    setCodec(null);
    setHwdec(null);
    try {
      await api.playRecording(camera, s, e);
    } catch (err) {
      setStatus("error");
      setError(String(err));
    }
  };

  const changeSpeed = async (v: number) => {
    setSpeed(v);
    try {
      await api.playerSetSpeed(v);
    } catch (err) {
      setError(String(err));
    }
  };

  const download = async () => {
    const s = toUnix(start);
    const e = toUnix(end);
    if (!(e > s)) {
      setError("Download: end time must be after start time.");
      return;
    }
    const stamp = start.replace(/[:T]/g, "-");
    const path = await save({
      defaultPath: `${camera}_${stamp}.mp4`,
      filters: [{ name: "Video", extensions: ["mp4"] }],
    });
    if (!path) return;
    setSavedPath(null);
    setDownloading(true);
    try {
      const bytes = await api.downloadClip(camera, s, e, path);
      setSavedPath(`Saved to ${path} · ${(bytes / 1_000_000).toFixed(1)} MB`);
    } catch (err) {
      setError(String(err));
    } finally {
      setDownloading(false);
    }
  };

  const hwLabel = hwdec && hwdec !== "no" ? hwdec : hwdec === "no" ? "software" : "—";
  const playing = status === "playing";

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          <span className="text-sky-600 dark:text-sky-400">{camera}</span>
        </h2>
        <p className="text-sm text-slate-500">
          Recordings play in a native mpv window (H.265/HEVC with D3D11VA hardware decode). Pick a range,
          use the timeline to jump to detections, or download the clip.
        </p>
      </div>

      {/* Range + actions */}
      <div className="card flex flex-wrap items-end gap-4 p-4">
        <div>
          <label className="field-label">Start</label>
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="input w-auto"
          />
        </div>
        <div>
          <label className="field-label">End</label>
          <input
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="input w-auto"
          />
        </div>
        <button onClick={() => void play(toUnix(start), toUnix(end))} className="btn btn-primary">
          <Play className="h-4 w-4" /> Play range
        </button>
        <button
          onClick={() => {
            const e = new Date();
            const s = new Date(e.getTime() - 3600_000);
            setStart(toLocalInput(s));
            setEnd(toLocalInput(e));
            void play(Math.floor(s.getTime() / 1000), Math.floor(e.getTime() / 1000));
          }}
          className="btn btn-outline"
        >
          Last hour
        </button>
        <button onClick={() => void download()} disabled={downloading} className="btn btn-outline">
          <Download className="h-4 w-4" />
          {downloading ? "Downloading…" : "Download"}
        </button>
      </div>

      {savedPath && (
        <div className="chip bg-emerald-100 px-3 py-1.5 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          {savedPath}
        </div>
      )}

      {/* Timeline */}
      <div className="card p-4">
        <Timeline
          camera={camera}
          startUnix={toUnix(start)}
          endUnix={toUnix(end)}
          onSeek={(t) => void play(t, toUnix(end))}
        />
      </div>

      {/* Playback controls */}
      <div className="card flex flex-wrap items-center gap-2 p-4">
        <button
          onClick={() => void api.playerSeek(-10).catch((e) => setError(String(e)))}
          disabled={!playing}
          className="btn btn-outline btn-sm"
        >
          <RotateCcw className="h-4 w-4" /> 10s
        </button>
        <button
          onClick={() => void api.playerTogglePause().catch((e) => setError(String(e)))}
          disabled={!playing}
          className="btn btn-outline btn-sm"
        >
          {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          onClick={() => void api.playerSeek(10).catch((e) => setError(String(e)))}
          disabled={!playing}
          className="btn btn-outline btn-sm"
        >
          <RotateCw className="h-4 w-4" /> 10s
        </button>
        <button
          onClick={() => void api.playerStop().catch((e) => setError(String(e)))}
          className="btn btn-outline btn-sm"
        >
          <Square className="h-4 w-4" /> Stop
        </button>

        <div className="flex items-center gap-1.5 pl-1 text-sm text-slate-500">
          <span>Speed</span>
          <select
            value={speed}
            onChange={(e) => void changeSpeed(Number(e.target.value))}
            className="input w-auto px-2 py-1.5"
          >
            {SPEEDS.map((v) => (
              <option key={v} value={v}>
                {v}×
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
          <span className={`chip ${STATUS_STYLES[status]}`}>{status}</span>
          <span>
            codec <b className="font-medium text-slate-700 dark:text-slate-200">{codec ?? "—"}</b>
          </span>
          <span>
            hw <b className="font-medium text-slate-700 dark:text-slate-200">{hwLabel}</b>
          </span>
          <span className="tabular-nums">
            {fmt(timePos)} / {fmt(duration)}
          </span>
        </div>
      </div>

      {lastError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {lastError}
        </div>
      )}

      <details className="text-xs text-slate-500">
        <summary className="cursor-default select-none font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
          Diagnostics (mpv events)
        </summary>
        <div
          ref={logRef}
          className="mt-2 h-28 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono dark:border-slate-800 dark:bg-slate-900"
        >
          {log.length === 0 ? (
            <span className="text-slate-400">No events yet.</span>
          ) : (
            log.map((l, i) => <div key={i}>{l}</div>)
          )}
        </div>
      </details>
    </div>
  );
}
