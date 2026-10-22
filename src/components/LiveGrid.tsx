import { useEffect, useRef, useState } from "react";
import { Camera, GripVertical, Loader2, Maximize2, Plus, X } from "lucide-react";
import type { CameraSummary } from "../api/types";
import { useStore } from "../lib/store";
import { playMse, type MseStatus } from "../player/mse";

type Layout = 1 | 2 | 4;

export default function LiveGrid({ cameras }: { cameras: CameraSummary[] }) {
  const port = useStore((s) => s.proxyPort);
  const ensureProxy = useStore((s) => s.ensureProxy);
  const [startErr, setStartErr] = useState<string | null>(null);
  const [layout, setLayout] = useState<Layout>(1);
  const [cells, setCells] = useState<(string | null)[]>([
    cameras[0]?.name ?? null,
    null,
    null,
    null,
  ]);

  useEffect(() => {
    ensureProxy().catch((e) => setStartErr(String(e)));
  }, [ensureProxy]);

  const srcOf = (name: string) =>
    cameras.find((c) => c.name === name)?.stream_name ?? name;

  const assign = (idx: number, name: string) =>
    setCells((prev) => prev.map((c, i) => (i === idx ? name : c)));
  const clear = (idx: number) =>
    setCells((prev) => prev.map((c, i) => (i === idx ? null : c)));
  const expand = (name: string) => {
    setCells((prev) => prev.map((c, i) => (i === 0 ? name : c)));
    setLayout(1);
  };
  const addToFirstEmpty = (name: string) =>
    setCells((prev) => {
      const i = prev.findIndex((c, idx) => idx < layout && c === null);
      const target = i === -1 ? 0 : i;
      return prev.map((c, idx) => (idx === target ? name : c));
    });

  const layouts: { value: Layout; label: string }[] = [
    { value: 1, label: "1" },
    { value: 2, label: "2" },
    { value: 4, label: "2×2" },
  ];
  const gridCols = layout === 1 ? "grid-cols-1" : "grid-cols-2";

  return (
    <div className="flex h-full min-h-0 gap-4">
      <aside className="flex w-52 shrink-0 flex-col">
        <div className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Cameras
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-auto pr-1">
          {cameras.map((cam) => (
            <div
              key={cam.name}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("camera", cam.name);
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => addToFirstEmpty(cam.name)}
              title="Drag into a tile, or click to add"
              className="group flex cursor-grab items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 text-sm text-slate-600 transition-colors hover:border-slate-200 hover:bg-white active:cursor-grabbing dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800"
            >
              <GripVertical className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-slate-400" />
              <Camera className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="truncate">{cam.name}</span>
              {!cam.enabled && (
                <span className="ml-auto text-[10px] uppercase text-slate-400">off</span>
              )}
            </div>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="seg">
            {layouts.map((l) => (
              <button
                key={l.value}
                onClick={() => setLayout(l.value)}
                className={`seg-item ${layout === l.value ? "seg-item-active" : ""}`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-400">Drag cameras into the tiles</span>
          {startErr && (
            <span className="ml-auto truncate text-sm text-red-600 dark:text-red-400">
              Proxy error: {startErr}
            </span>
          )}
        </div>

        <div className={`grid min-h-0 flex-1 auto-rows-fr gap-3 ${gridCols}`}>
          {cells.slice(0, layout).map((name, idx) => (
            <LiveCell
              key={idx}
              name={name}
              src={name ? srcOf(name) : null}
              port={port}
              onAssign={(c) => assign(idx, c)}
              onClear={() => clear(idx)}
              onExpand={() => name && expand(name)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function LiveCell({
  name,
  src,
  port,
  onAssign,
  onClear,
  onExpand,
}: {
  name: string | null;
  src: string | null;
  port: number | null;
  onAssign: (camera: string) => void;
  onClear: () => void;
  onExpand: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<MseStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!name || !src || !port || !videoRef.current) return;
    setError(null);
    setStatus("connecting");
    const url = `ws://127.0.0.1:${port}/live/mse/api/ws?src=${encodeURIComponent(src)}`;
    const handle = playMse(url, videoRef.current, {
      onStatus: setStatus,
      onError: (m) => setError(m),
    });
    return () => handle.stop();
  }, [name, src, port]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const camera = e.dataTransfer.getData("camera");
    if (camera) onAssign(camera);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`group relative overflow-hidden rounded-xl border bg-slate-950 transition-colors ${
        dragOver
          ? "border-sky-500 ring-2 ring-sky-500/30"
          : "border-slate-300 dark:border-slate-700"
      }`}
    >
      {name ? (
        <>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="h-full w-full object-contain"
          />

          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-3 py-2 opacity-0 transition-opacity group-hover:opacity-100">
            <span className="flex items-center gap-1.5 text-xs font-medium text-white">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  status === "playing"
                    ? "bg-emerald-400"
                    : status === "error"
                      ? "bg-red-400"
                      : "bg-amber-400"
                }`}
              />
              {name}
            </span>
            <div className="pointer-events-auto flex items-center gap-1">
              <button onClick={onExpand} title="Expand" className="rounded-md p-1 text-white hover:bg-white/20">
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
              <button onClick={onClear} title="Remove" className="rounded-md p-1 text-white hover:bg-white/20">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {status === "connecting" && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-white/80">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/70 p-4 text-center">
              <span className="text-sm font-medium text-red-300">Stream error</span>
              <span className="text-xs text-red-200/70">{error}</span>
            </div>
          )}
        </>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-500">
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-slate-600 text-slate-500">
            <Plus className="h-5 w-5" />
          </span>
          <span className="text-sm">Drop a camera here</span>
        </div>
      )}
    </div>
  );
}
