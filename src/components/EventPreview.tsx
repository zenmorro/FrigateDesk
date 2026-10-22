import { useState } from "react";
import { createPortal } from "react-dom";
import type { EventItem } from "../api/types";

export function previewUrl(port: number, eventId: string) {
  return `http://127.0.0.1:${port}/api/events/${eventId}/preview.gif`;
}
export function thumbUrl(port: number, eventId: string) {
  return `http://127.0.0.1:${port}/api/events/${eventId}/thumbnail.jpg`;
}

/** Floating hover preview: an animated preview.gif of the event (falls back to
 *  the thumbnail if no preview exists), positioned near the cursor. */
export default function EventPreview({
  event,
  port,
  x,
  y,
}: {
  event: EventItem;
  port: number | null;
  x: number;
  y: number;
}) {
  const [failed, setFailed] = useState(false);

  if (!port) return null;

  const W = 340;
  const left = x + W + 28 > window.innerWidth ? x - W - 16 : x + 16;
  const top = Math.max(8, Math.min(y + 16, window.innerHeight - 248));
  const when = new Date(event.start_time * 1000).toLocaleString();

  return createPortal(
    <div
      style={{ left, top, width: W }}
      className="pointer-events-none fixed z-[60] overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
    >
      <img
        src={failed ? thumbUrl(port, event.id) : previewUrl(port, event.id)}
        alt=""
        onError={() => setFailed(true)}
        className="aspect-video w-full bg-black object-contain"
      />
      <div className="flex items-center justify-between px-3 py-2 text-xs text-slate-200">
        <span className="font-medium capitalize">{event.label ?? "event"}</span>
        <span className="text-slate-400">{when}</span>
      </div>
    </div>,
    document.body,
  );
}
