import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import { useStore } from "../lib/store";
import NavRail, { type View } from "./NavRail";
import PlayerSpike from "./PlayerSpike";
import LiveGrid from "./LiveGrid";
import EventsView from "./EventsView";

const TITLES: Record<View, string> = {
  live: "Live view",
  history: "History",
  events: "Events",
};

export default function Dashboard() {
  const connected = useStore((s) => s.connected)!;
  const profiles = useStore((s) => s.profiles);

  const ensureProxy = useStore((s) => s.ensureProxy);
  const profile = profiles.find((p) => p.id === connected.profileId);
  const [view, setView] = useState<View>("live");
  const [selected, setSelected] = useState<string | null>(
    connected.cameras[0]?.name ?? null,
  );

  // Start the local auth proxy once; live view and image previews rely on it.
  useEffect(() => {
    ensureProxy().catch(() => {});
  }, [ensureProxy]);

  return (
    <div className="flex h-full">
      <NavRail view={view} onChange={setView} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white/60 px-5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/40">
          <h1 className="text-[15px] font-semibold tracking-tight">{TITLES[view]}</h1>
          <div className="flex items-center gap-2.5 text-sm text-slate-500">
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {profile?.name ?? "Server"}
            </span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span>Frigate v{connected.version}</span>
            <span className="chip bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              online
            </span>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden">
          {view === "live" &&
            (connected.cameras.length ? (
              <div className="h-full p-4">
                <LiveGrid cameras={connected.cameras} />
              </div>
            ) : (
              <EmptyCameras />
            ))}

          {view === "history" && (
            <div className="flex h-full min-h-0">
              <CameraList selected={selected} onSelect={setSelected} />
              <section className="min-w-0 flex-1 overflow-auto p-5">
                {selected ? <PlayerSpike camera={selected} /> : <EmptyCameras />}
              </section>
            </div>
          )}

          {view === "events" && <EventsView />}
        </main>
      </div>
    </div>
  );
}

function CameraList({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (name: string) => void;
}) {
  const cameras = useStore((s) => s.connected!.cameras);
  return (
    <aside className="w-64 shrink-0 overflow-auto border-r border-slate-200 bg-white/40 p-3 dark:border-slate-800 dark:bg-slate-900/20">
      <div className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Cameras · {cameras.length}
      </div>
      <div className="space-y-1">
        {cameras.map((cam) => {
          const active = selected === cam.name;
          return (
            <button
              key={cam.name}
              onClick={() => onSelect(cam.name)}
              className={`flex w-full cursor-default items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                active
                  ? "bg-sky-50 font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              <Camera className={`h-4 w-4 shrink-0 ${active ? "text-sky-500" : "text-slate-400"}`} />
              <span className="truncate">{cam.name}</span>
              {!cam.enabled && (
                <span className="ml-auto text-[10px] uppercase text-slate-400">off</span>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function EmptyCameras() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      <div className="text-sm text-slate-500">
        No cameras found in <code className="rounded bg-slate-200 px-1 dark:bg-slate-800">/api/config</code>.
      </div>
    </div>
  );
}
