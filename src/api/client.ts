import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ConnectResult,
  EventItem,
  MpvMessage,
  ReviewItem,
  ServerProfile,
} from "./types";

/**
 * Typed wrapper around the Tauri command layer. The UI never talks to Frigate
 * directly — everything goes through the Rust backend so secrets, cookies and
 * TLS handling stay out of the webview.
 *
 * Note: Tauri maps camelCase JS argument keys to snake_case Rust parameters.
 */
export const api = {
  listProfiles: () => invoke<ServerProfile[]>("list_profiles"),

  saveProfile: (profile: ServerProfile, password?: string) =>
    invoke<ServerProfile[]>("save_profile", {
      profile,
      password: password ?? null,
    }),

  deleteProfile: (id: string) => invoke<ServerProfile[]>("delete_profile", { id }),

  hasSavedPassword: (id: string) => invoke<boolean>("has_saved_password", { id }),

  connect: (profileId: string, password?: string) =>
    invoke<ConnectResult>("connect", { profileId, password: password ?? null }),

  disconnect: () => invoke<void>("disconnect"),

  playRecording: (camera: string, start: number, end: number) =>
    invoke<string>("play_recording", { camera, start, end }),

  playerSetSpeed: (speed: number) => invoke<void>("player_set_speed", { speed }),

  playerSeek: (seconds: number) => invoke<void>("player_seek", { seconds }),

  playerTogglePause: () => invoke<void>("player_toggle_pause"),

  playerStop: () => invoke<void>("player_stop"),

  /** Start the local auth proxy for live view; returns its loopback port. */
  startProxy: () => invoke<number>("start_proxy"),

  stopProxy: () => invoke<void>("stop_proxy"),

  /** Download a recording clip (camera + Unix second range) to a local path. */
  downloadClip: (camera: string, start: number, end: number, dest: string) =>
    invoke<number>("download_clip", { camera, start, end, dest }),

  /** Review segments (timeline bars) for a camera within a Unix-second range. */
  getReview: (camera: string, after: number, before: number) =>
    invoke<ReviewItem[]>("get_review", { camera, after, before }),

  /** Tracked-object events for a camera within a Unix-second range. */
  getEvents: (camera: string, after: number, before: number) =>
    invoke<EventItem[]>("get_events", { camera, after, before }),

  /** Search events across cameras (empty/undefined = all) within a range. */
  searchEvents: (
    cameras: string | null,
    after: number,
    before: number,
    limit: number,
  ) => invoke<EventItem[]>("search_events", { cameras, after, before, limit }),
};

export function onMpvMessage(cb: (m: MpvMessage) => void): Promise<UnlistenFn> {
  return listen<MpvMessage>("mpv://message", (e) => cb(e.payload));
}

export function onMpvError(cb: (m: MpvMessage) => void): Promise<UnlistenFn> {
  return listen<MpvMessage>("mpv://error", (e) => cb(e.payload));
}

export function onMpvClosed(cb: () => void): Promise<UnlistenFn> {
  return listen("mpv://closed", () => cb());
}
