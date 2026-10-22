import { Bell, Clapperboard, LogOut, Moon, Sun, Video } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useStore } from "../lib/store";

export type View = "live" | "history" | "events";

const ITEMS: { id: View; icon: LucideIcon; label: string; soon?: boolean }[] = [
  { id: "live", icon: Video, label: "Live" },
  { id: "history", icon: Clapperboard, label: "History" },
  { id: "events", icon: Bell, label: "Events" },
];

export default function NavRail({
  view,
  onChange,
}: {
  view: View;
  onChange: (v: View) => void;
}) {
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const disconnect = useStore((s) => s.disconnect);

  return (
    <nav className="flex w-[72px] shrink-0 flex-col items-center gap-1 border-r border-slate-200 bg-white py-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-sky-600 text-white shadow-sm">
        <Video className="h-5 w-5" />
      </div>

      {ITEMS.map((it) => (
        <RailButton
          key={it.id}
          icon={it.icon}
          label={it.label}
          active={view === it.id}
          soon={it.soon}
          onClick={() => !it.soon && onChange(it.id)}
        />
      ))}

      <div className="mt-auto flex flex-col items-center gap-1">
        <button onClick={toggleTheme} title="Toggle theme" className="icon-btn">
          {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>
        <button
          onClick={() => void disconnect()}
          title="Disconnect / switch server"
          className="icon-btn hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </nav>
  );
}

function RailButton({
  icon: Icon,
  label,
  active,
  soon,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  soon?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={soon ? `${label} (coming soon)` : label}
      className={`relative flex w-14 cursor-default flex-col items-center gap-1 rounded-xl py-2.5 text-[10px] font-medium transition-colors ${
        active
          ? "bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400"
          : "text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      } ${soon ? "opacity-40" : ""}`}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-r-full bg-sky-500" />
      )}
      <Icon className="h-5 w-5" />
      {label}
    </button>
  );
}
