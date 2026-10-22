import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { api } from "../api/client";
import type { EventItem, ReviewItem } from "../api/types";
import { useStore } from "../lib/store";
import EventPreview from "./EventPreview";

function fmtClock(unix: number): string {
  const d = new Date(unix * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function severityColor(sev: string | null): string {
  switch (sev) {
    case "alert":
      return "bg-red-500/80";
    case "detection":
      return "bg-orange-400/80";
    default:
      return "bg-slate-400/80";
  }
}

export default function Timeline({
  camera,
  startUnix,
  endUnix,
  onSeek,
}: {
  camera: string;
  startUnix: number;
  endUnix: number;
  onSeek: (t: number) => void;
}) {
  const port = useStore((s) => s.proxyPort);
  const [review, setReview] = useState<ReviewItem[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hover, setHover] = useState<{ event: EventItem; x: number; y: number } | null>(null);

  const load = () => {
    if (!(endUnix > startUnix)) return;
    setLoading(true);
    setErr(null);
    Promise.all([
      api.getReview(camera, startUnix, endUnix),
      api.getEvents(camera, startUnix, endUnix),
    ])
      .then(([r, e]) => {
        setReview(r);
        setEvents(e);
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  };

  // Debounced reload when camera or range changes.
  useEffect(() => {
    const id = setTimeout(load, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, startUnix, endUnix]);

  const span = Math.max(1, endUnix - startUnix);
  const clampPct = (t: number) =>
    Math.min(100, Math.max(0, ((t - startUnix) / span) * 100));

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    onSeek(Math.round(startUnix + frac * span));
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3 text-xs">
        <span className="font-semibold uppercase text-slate-400">Timeline</span>
        <Legend color="bg-red-500" label="alert" />
        <Legend color="bg-orange-400" label="detection" />
        <Legend color="bg-sky-500" label="event" />
        <button
          onClick={load}
          className="ml-auto flex items-center gap-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Reload
        </button>
      </div>

      {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}

      <div
        onClick={handleClick}
        title="Click to play from this time"
        className="relative h-12 w-full cursor-pointer overflow-hidden rounded border border-slate-300 bg-slate-100 dark:border-slate-700 dark:bg-slate-800"
      >
        {review.map((r) => {
          const left = clampPct(r.start_time);
          const endT = r.end_time ?? r.start_time + 5;
          const width = Math.max(0.4, clampPct(endT) - left);
          const objs = r.data?.objects?.join(", ") ?? "";
          return (
            <div
              key={r.id}
              className={`absolute top-1 h-5 rounded-sm ${severityColor(r.severity)}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${r.severity ?? "review"} · ${fmtClock(r.start_time)}${objs ? " · " + objs : ""}`}
            />
          );
        })}

        {events.map((ev) => (
          <div
            key={ev.id}
            onMouseEnter={(e) => setHover({ event: ev, x: e.clientX, y: e.clientY })}
            onMouseMove={(e) => setHover({ event: ev, x: e.clientX, y: e.clientY })}
            onMouseLeave={() => setHover((h) => (h?.event.id === ev.id ? null : h))}
            className="absolute inset-y-0 w-2 -translate-x-1/2 cursor-pointer"
            style={{ left: `${clampPct(ev.start_time)}%` }}
          >
            <div className="absolute bottom-1 left-1/2 h-5 w-0.5 -translate-x-1/2 bg-sky-500" />
          </div>
        ))}

        {review.length === 0 && events.length === 0 && !loading && !err && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-400">
            No detections in this range
          </div>
        )}
      </div>

      <div className="flex justify-between text-[10px] text-slate-400">
        <span>{fmtClock(startUnix)}</span>
        <span>{fmtClock(startUnix + span / 2)}</span>
        <span>{fmtClock(endUnix)}</span>
      </div>

      {hover && <EventPreview event={hover.event} port={port} x={hover.x} y={hover.y} />}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-slate-500">
      <span className={`inline-block h-2 w-2 rounded-sm ${color}`} />
      {label}
    </span>
  );
}
