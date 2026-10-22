// Minimal MSE (Media Source Extensions) player for go2rtc's WebSocket protocol,
// as proxied by Frigate at /live/mse/api/ws?src=<stream>.
//
// Protocol: on open we send the list of codecs the WebView can decode; go2rtc
// replies with a chosen `video/mp4; codecs="..."` mime, then streams fragmented
// MP4 as binary frames which we append to a SourceBuffer. If the codec isn't
// supported (e.g. HEVC in a WebView without hardware), we surface an explicit
// error instead of hanging on a spinner.
//
// Adapted from the approach in go2rtc's video-rtc.js (MIT).

export type MseStatus = "connecting" | "playing" | "error" | "closed";

export interface MseCallbacks {
  onStatus?: (s: MseStatus) => void;
  onError?: (message: string) => void;
}

export interface MsePlayerHandle {
  stop: () => void;
}

// Candidate codecs advertised to go2rtc, filtered by what the WebView supports.
const CODECS = [
  "avc1.640029", // H.264 High 4.1
  "avc1.64002A", // H.264 High 4.2
  "avc1.640033", // H.264 High 5.1
  "hvc1.1.6.L153.B0", // H.265
  "mp4a.40.2", // AAC-LC
  "mp4a.40.5", // AAC-HE
  "flac",
  "opus",
];

export function playMse(
  wsUrl: string,
  video: HTMLVideoElement,
  cb: MseCallbacks = {},
): MsePlayerHandle {
  let ws: WebSocket | null = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  let mediaSource: MediaSource | null = null;
  let sourceBuffer: SourceBuffer | null = null;
  const queue: ArrayBuffer[] = [];
  let stopped = false;

  cb.onStatus?.("connecting");

  const mseSupported = (codecs: string) =>
    "MediaSource" in window &&
    MediaSource.isTypeSupported(`video/mp4; codecs="${codecs}"`);

  ws.onopen = () => {
    if (stopped) return;
    if (!("MediaSource" in window)) {
      fail("MediaSource is not available in this WebView.");
      return;
    }
    const value = CODECS.filter(mseSupported).join();
    ws?.send(JSON.stringify({ type: "mse", value }));
  };

  ws.onmessage = (ev) => {
    if (stopped) return;
    if (typeof ev.data === "string") {
      let msg: { type?: string; value?: string };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "mse" && msg.value) initMse(msg.value);
      else if (msg.type === "error") fail(msg.value || "stream error");
      return;
    }
    queue.push(ev.data as ArrayBuffer);
    flush();
  };

  ws.onerror = () => fail("WebSocket connection error.");
  ws.onclose = () => {
    if (!stopped) cb.onStatus?.("closed");
  };

  function initMse(mime: string) {
    if (!MediaSource.isTypeSupported(mime)) {
      fail(`Codec not supported by this WebView: ${mime}`);
      return;
    }
    mediaSource = new MediaSource();
    video.src = URL.createObjectURL(mediaSource);
    mediaSource.addEventListener(
      "sourceopen",
      () => {
        if (stopped || !mediaSource) return;
        try {
          sourceBuffer = mediaSource.addSourceBuffer(mime);
          sourceBuffer.mode = "segments";
          sourceBuffer.addEventListener("updateend", flush);
          cb.onStatus?.("playing");
          flush();
        } catch (e) {
          fail(String(e));
        }
      },
      { once: true },
    );
  }

  function flush() {
    if (!sourceBuffer || sourceBuffer.updating || queue.length === 0) return;
    // Trim buffered data older than ~15s to bound memory and stay near live.
    try {
      if (sourceBuffer.buffered.length) {
        const end = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1) - 15;
        const start = sourceBuffer.buffered.start(0);
        if (end > start) {
          sourceBuffer.remove(start, end);
          return; // resume on updateend
        }
      }
    } catch {
      /* ignore buffer errors */
    }
    const buf = queue.shift();
    if (!buf) return;
    try {
      sourceBuffer.appendBuffer(buf);
    } catch (e) {
      fail(String(e));
    }
  }

  // Keep playback close to the live edge.
  const liveEdge = () => {
    if (!sourceBuffer || !sourceBuffer.buffered.length) return;
    const end = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
    if (end - video.currentTime > 3) video.currentTime = end - 0.5;
  };
  video.addEventListener("timeupdate", liveEdge);

  function fail(message: string) {
    if (stopped) return;
    cb.onStatus?.("error");
    cb.onError?.(message);
    cleanup();
  }

  function cleanup() {
    stopped = true;
    video.removeEventListener("timeupdate", liveEdge);
    try {
      if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
    try {
      if (sourceBuffer && mediaSource && mediaSource.readyState === "open") {
        mediaSource.removeSourceBuffer(sourceBuffer);
      }
    } catch {
      /* ignore */
    }
    try {
      video.removeAttribute("src");
      video.load();
    } catch {
      /* ignore */
    }
    sourceBuffer = null;
    mediaSource = null;
    queue.length = 0;
  }

  return { stop: cleanup };
}
