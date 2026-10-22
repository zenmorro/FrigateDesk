import { useState } from "react";
import { useStore } from "../lib/store";
import type { ServerProfile } from "../api/types";

interface Props {
  existing?: ServerProfile;
  onDone: () => void;
}

const emptyProfile = (): ServerProfile => ({
  id: crypto.randomUUID(),
  name: "",
  base_url: "https://",
  username: "",
  allow_insecure: false,
  requires_auth: true,
});

export default function ProfileForm({ existing, onDone }: Props) {
  const saveProfile = useStore((s) => s.saveProfile);
  const setError = useStore((s) => s.setError);
  const [p, setP] = useState<ServerProfile>(existing ?? emptyProfile());
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const update = (patch: Partial<ServerProfile>) => setP((prev) => ({ ...prev, ...patch }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await saveProfile(p, password || undefined);
      onDone();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-4 p-6">
      <h3 className="text-lg font-semibold tracking-tight">
        {existing ? "Edit server" : "Add server"}
      </h3>

      <div>
        <label className="field-label">Name</label>
        <input
          className="input"
          value={p.name}
          onChange={(e) => update({ name: e.target.value })}
          placeholder="Home NVR"
          required
        />
      </div>

      <div>
        <label className="field-label">Base URL (include port, e.g. :8971)</label>
        <input
          className="input"
          value={p.base_url}
          onChange={(e) => update({ base_url: e.target.value })}
          placeholder="https://nvr.local:8971"
          required
        />
      </div>

      <Toggle
        checked={p.requires_auth}
        onChange={(v) => update({ requires_auth: v })}
        title="Requires authentication"
        subtitle="Frigate 0.14+ on port 8971"
      />

      {p.requires_auth && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">Username</label>
            <input
              className="input"
              value={p.username}
              onChange={(e) => update({ username: e.target.value })}
              autoComplete="username"
            />
          </div>
          <div>
            <label className="field-label">
              Password {existing && <span className="text-slate-400">(blank = keep)</span>}
            </label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
        </div>
      )}

      <Toggle
        checked={p.allow_insecure}
        onChange={(v) => update({ allow_insecure: v })}
        title="Allow self-signed certificate"
        subtitle="Skip TLS verification for this server"
      />

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onDone} className="btn btn-ghost">
          Cancel
        </button>
        <button type="submit" disabled={saving} className="btn btn-primary">
          {saving ? "Saving…" : "Save server"}
        </button>
      </div>
    </form>
  );
}

function Toggle({
  checked,
  onChange,
  title,
  subtitle,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full cursor-default items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-left transition-colors hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50"
    >
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-slate-500">{subtitle}</span>
      </span>
      <span
        className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${
          checked ? "bg-sky-600" : "bg-slate-300 dark:bg-slate-600"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            checked ? "left-[18px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
