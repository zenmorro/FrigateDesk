import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, Play, RefreshCw } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { api } from "../api/client";
import type { EventItem } from "../api/types";
import { useStore } from "../lib/store";
import EventPreview, { thumbUrl } from "./EventPreview";

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toUnix(local: string): number {
  return Math.floor(new Date(local).getTime() / 1000);
}
function duration(ev: EventItem): string {
  if (ev.end_time == null) return "live";
  const s = Math.max(0, Math.round(ev.end_time - ev.start_time));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

export default function EventsView() {
  const cameras = useStore((s) => s.connected!.cameras);
  const port = useStore((s) => s.proxyPort);
  const ensureProxy = useStore((s) => s.ensureProxy);
  const setError = useStore((s) => s.setError);

  const now = new Date();
  const [cam, setCam] = useState("");
  const [after, setAfter] = useState(toLocalInput(new Date(now.getTime() - 24 * 3600_000)));
  const [before, setBefore] = useState(toLocalInput(now));
  const [label, setLabel] = useState("");
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hover, setHover] = useState<{ event: EventItem; x: number; y: number } | null>(null);

  useEffect(() => {
    ensureProxy().catch(() => {});
  }, [ensureProxy]);

  const load = () => {
    setLoading(true);
    setErr(null);
    api
      .searchEvents(cam || null, toUnix(after), toUnix(before), 500)
      .then(setEvents)
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const id = setTimeout(load, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cam, after, before]);

  const labels = useMemo(
    () => Array.from(new Set(events.map((e) => e.label).filter(Boolean))) as string[],
    [events],
  );
  const filtered = label ? events.filter((e) => e.label === label) : events;

  const openClip = (ev: EventItem) =>
    void api
      .playRecording(
        ev.camera,
        Math.floor(ev.start_time),
        Math.ceil(ev.end_time ?? ev.start_time + 10),
      )
      .catch((e) => setError(String(e)));

  const download = async (ev: EventItem) => {
    const stamp = new Date(ev.start_time * 1000)
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, "-");
    const path = await save({
      defaultPath: `${ev.camera}_${ev.label ?? "event"}_${stamp}.mp4`,
      filters: [{ name: "Video", extensions: ["mp4"] }],
    });
    if (!path) return;
    try {
      await api.downloadClip(
        ev.camera,
        Math.floor(ev.start_time),
        Math.ceil(ev.end_time ?? ev.start_time + 10),
        path,
      );
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
        <div>
          <label className="field-label">Camera</label>
          <select value={cam} onChange={(e) => setCam(e.target.value)} className="input w-auto">
            <option value="">All cameras</option>
            {cameras.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">Label</label>
          <select value={label} onChange={(e) => setLabel(e.target.value)} className="input w-auto">
            <option value="">All labels</option>
            {labels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">From</label>
          <input
            type="datetime-local"
            value={after}
            onChange={(e) => setAfter(e.target.value)}
            className="input w-auto"
          />
        </div>
        <div>
          <label className="field-label">To</label>
          <input
            type="datetime-local"
            value={before}
            onChange={(e) => setBefore(e.target.value)}
            className="input w-auto"
          />
        </div>
        <button onClick={load} className="btn btn-outline">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Reload
        </button>
        <span className="ml-auto text-sm text-slate-500">{filtered.length} events</span>
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {err && <div className="mb-3 text-sm text-red-600 dark:text-red-400">{err}</div>}

        {!loading && filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            No events in this range.
          </div>
        ) : (
          <div className="mx-auto grid max-w-4xl gap-2">
            {filtered.map((ev) => (
              <div
                key={ev.id}
                onMouseEnter={(e) => setHover({ event: ev, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => setHover({ event: ev, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHover((h) => (h?.event.id === ev.id ? null : h))}
                className="card flex items-center gap-3 p-2.5 transition-colors hover:border-sky-300 dark:hover:border-sky-800"
              >
                <div className="h-14 w-24 shrink-0 overflow-hidden rounded-md bg-slate-200 dark:bg-slate-800">
                  {port && (
                    <img
                      src={thumbUrl(port, ev.id)}
                      alt=""
                      className="h-full w-full object-cover"
                      onError={(e) => (e.currentTarget.style.visibility = "hidden")}
                    />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium capitalize">{ev.label ?? "event"}</span>
                    <span className="chip bg-slate-100 text-slate-500 dark:bg-slate-800">{ev.camera}</span>
                    {ev.score != null && (
                      <span className="text-xs text-slate-400">{Math.round(ev.score * 100)}%</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">
                    {new Date(ev.start_time * 1000).toLocaleString()} · {duration(ev)}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => openClip(ev)} className="btn btn-outline btn-sm" title="Play clip">
                    <Play className="h-4 w-4" /> Open
                  </button>
                  <button onClick={() => void download(ev)} className="icon-btn" title="Download clip">
                    <Download className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {hover && <EventPreview event={hover.event} port={port} x={hover.x} y={hover.y} />}
    </div>
  );
}
