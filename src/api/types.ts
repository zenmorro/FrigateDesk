// Types mirroring the Rust backend DTOs. Field names use snake_case because
// they are (de)serialized by serde on the Rust side.

export interface ServerProfile {
  id: string;
  name: string;
  base_url: string;
  username: string;
  allow_insecure: boolean;
  requires_auth: boolean;
}

export interface CameraSummary {
  name: string;
  enabled: boolean;
  stream_name: string;
}

export interface ConnectResult {
  profile_id: string;
  version: string;
  cameras: CameraSummary[];
}

/** A Frigate review segment (timeline bar). */
export interface ReviewItem {
  id: string;
  camera: string;
  start_time: number;
  end_time: number | null;
  severity: string | null;
  data: {
    objects?: string[];
    zones?: string[];
    audio?: string[];
    detections?: string[];
  } | null;
}

/** A Frigate tracked-object event. */
export interface EventItem {
  id: string;
  camera: string;
  label: string | null;
  start_time: number;
  end_time: number | null;
  score: number | null;
  has_clip: boolean | null;
  has_snapshot: boolean | null;
}

/** A line of mpv JSON-IPC output forwarded from the backend. */
export interface MpvMessage {
  event?: string;
  /** property name for `property-change` events */
  name?: string;
  data?: unknown;
  reason?: string;
  /** present when the line could not be parsed as JSON */
  raw?: string;
  [key: string]: unknown;
}
