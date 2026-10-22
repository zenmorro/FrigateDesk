import { useState } from "react";
import { Moon, Pencil, Plug, Plus, Server, Shield, Sun, Trash2, Video } from "lucide-react";
import { useStore } from "../lib/store";
import { api } from "../api/client";
import type { ServerProfile } from "../api/types";
import ProfileForm from "./ProfileForm";

export default function ServerPicker() {
  const profiles = useStore((s) => s.profiles);
  const busy = useStore((s) => s.busy);
  const connect = useStore((s) => s.connect);
  const deleteProfile = useStore((s) => s.deleteProfile);
  const setError = useStore((s) => s.setError);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ServerProfile | null>(null);
  const [pwFor, setPwFor] = useState<string | null>(null);
  const [pw, setPw] = useState("");

  const startConnect = async (profile: ServerProfile) => {
    try {
      if (profile.requires_auth) {
        const hasPw = await api.hasSavedPassword(profile.id);
        if (!hasPw) {
          setPwFor(profile.id);
          setPw("");
          return;
        }
      }
      await connect(profile.id);
    } catch {
      /* error surfaced via store */
    }
  };

  const confirmPassword = async (profile: ServerProfile) => {
    try {
      await connect(profile.id, pw);
      setPwFor(null);
    } catch {
      /* keep the prompt open so the user can retry */
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between px-6">
        <div className="flex items-center gap-2 font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-600 text-white">
            <Video className="h-4 w-4" />
          </span>
          FrigateDesk
        </div>
        <button onClick={toggleTheme} title="Toggle theme" className="icon-btn">
          {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto px-6 py-8">
        <div className="w-full max-w-xl">
          {adding || editing ? (
            <ProfileForm
              existing={editing ?? undefined}
              onDone={() => {
                setAdding(false);
                setEditing(null);
              }}
            />
          ) : (
            <>
              <div className="mb-5 flex items-end justify-between">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">Your servers</h2>
                  <p className="text-sm text-slate-500">Connect to a Frigate NVR instance.</p>
                </div>
                <button onClick={() => setAdding(true)} className="btn btn-primary">
                  <Plus className="h-4 w-4" /> Add server
                </button>
              </div>

              {profiles.length === 0 ? (
                <div className="card flex flex-col items-center gap-3 border-dashed p-10 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-400 dark:bg-slate-800">
                    <Server className="h-6 w-6" />
                  </span>
                  <div className="font-medium">No servers yet</div>
                  <p className="max-w-xs text-sm text-slate-500">
                    Add your Frigate server (URL, port 8971, credentials) to get started.
                  </p>
                  <button onClick={() => setAdding(true)} className="btn btn-primary mt-1">
                    <Plus className="h-4 w-4" /> Add server
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {profiles.map((profile) => (
                    <div key={profile.id} className="card p-4">
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800">
                          <Server className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{profile.name}</div>
                          <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                            <span className="truncate">{profile.base_url}</span>
                            {profile.requires_auth && profile.username && (
                              <span className="chip bg-slate-100 text-slate-500 dark:bg-slate-800">
                                {profile.username}
                              </span>
                            )}
                            {profile.allow_insecure && (
                              <span className="chip bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                <Shield className="h-3 w-3" /> self-signed
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={() => void startConnect(profile)}
                            disabled={busy}
                            className="btn btn-primary btn-sm"
                          >
                            <Plug className="h-4 w-4" /> Connect
                          </button>
                          <button onClick={() => setEditing(profile)} className="icon-btn" title="Edit">
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Delete profile "${profile.name}"?`))
                                void deleteProfile(profile.id).catch((e) => setError(String(e)));
                            }}
                            className="icon-btn hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      {pwFor === profile.id && (
                        <div className="mt-4 flex items-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                          <div className="flex-1">
                            <label className="field-label">Password</label>
                            <input
                              autoFocus
                              type="password"
                              value={pw}
                              onChange={(e) => setPw(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && void confirmPassword(profile)}
                              className="input"
                            />
                          </div>
                          <button
                            onClick={() => void confirmPassword(profile)}
                            disabled={busy}
                            className="btn btn-primary"
                          >
                            {busy ? "…" : "Login"}
                          </button>
                          <button onClick={() => setPwFor(null)} className="btn btn-ghost">
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
