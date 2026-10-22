import { create } from "zustand";
import { api } from "../api/client";
import type { CameraSummary, ServerProfile } from "../api/types";

type Theme = "light" | "dark";

interface Connected {
  profileId: string;
  version: string;
  cameras: CameraSummary[];
}

interface AppStore {
  profiles: ServerProfile[];
  connected: Connected | null;
  busy: boolean;
  error: string | null;
  theme: Theme;
  /** Loopback port of the local auth proxy (for live + image previews). */
  proxyPort: number | null;

  init: () => Promise<void>;
  refreshProfiles: () => Promise<void>;
  saveProfile: (p: ServerProfile, password?: string) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
  connect: (profileId: string, password?: string) => Promise<void>;
  disconnect: () => Promise<void>;
  ensureProxy: () => Promise<void>;
  setError: (e: string | null) => void;
  toggleTheme: () => void;
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

// Dedupe concurrent proxy starts (Dashboard + LiveGrid + StrictMode double-mount
// would otherwise each start a proxy, and the backend restart would kill the
// live WebSocket and break image previews).
let proxyStart: Promise<void> | null = null;

export const useStore = create<AppStore>((set, get) => ({
  profiles: [],
  connected: null,
  busy: false,
  error: null,
  theme: (localStorage.getItem("theme") as Theme | null) ?? "dark",
  proxyPort: null,

  init: async () => {
    applyTheme(get().theme);
    await get().refreshProfiles();
  },

  refreshProfiles: async () => {
    set({ profiles: await api.listProfiles() });
  },

  saveProfile: async (p, password) => {
    set({ profiles: await api.saveProfile(p, password) });
  },

  deleteProfile: async (id) => {
    set({ profiles: await api.deleteProfile(id) });
  },

  connect: async (profileId, password) => {
    set({ busy: true, error: null });
    try {
      const res = await api.connect(profileId, password);
      set({
        connected: {
          profileId: res.profile_id,
          version: res.version,
          cameras: res.cameras,
        },
      });
    } catch (e) {
      set({ error: String(e) });
      throw e;
    } finally {
      set({ busy: false });
    }
  },

  disconnect: async () => {
    await api.disconnect();
    set({ connected: null, proxyPort: null });
  },

  ensureProxy: async () => {
    if (get().proxyPort != null) return;
    if (proxyStart) return proxyStart;
    proxyStart = (async () => {
      try {
        const port = await api.startProxy();
        set({ proxyPort: port });
      } finally {
        proxyStart = null;
      }
    })();
    return proxyStart;
  },

  setError: (error) => set({ error }),

  toggleTheme: () => {
    const theme: Theme = get().theme === "dark" ? "light" : "dark";
    localStorage.setItem("theme", theme);
    applyTheme(theme);
    set({ theme });
  },
}));
