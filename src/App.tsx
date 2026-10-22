import { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useStore } from "./lib/store";
import ServerPicker from "./components/ServerPicker";
import Dashboard from "./components/Dashboard";

export default function App() {
  const connected = useStore((s) => s.connected);
  const error = useStore((s) => s.error);
  const setError = useStore((s) => s.setError);
  const init = useStore((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="relative flex h-full flex-col">
      {error && (
        <div className="absolute inset-x-0 top-0 z-50 flex items-start justify-between gap-3 border-b border-red-200 bg-red-50/95 px-4 py-2.5 text-sm text-red-700 backdrop-blur dark:border-red-900/50 dark:bg-red-950/70 dark:text-red-300">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="whitespace-pre-wrap">{error}</span>
          </div>
          <button onClick={() => setError(null)} className="icon-btn -my-1 shrink-0 p-1">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {connected ? <Dashboard /> : <ServerPicker />}
      </div>
    </div>
  );
}
