import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { api } from "./client";
import type { ServerProfile } from "./types";

const profile: ServerProfile = {
  id: "1",
  name: "n",
  base_url: "https://nvr.local:8971",
  username: "admin",
  allow_insecure: false,
  requires_auth: true,
};

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

describe("api client contract", () => {
  it("maps connect args to the camelCase command keys Tauri expects", async () => {
    await api.connect("p1", "pw");
    expect(invokeMock).toHaveBeenCalledWith("connect", {
      profileId: "p1",
      password: "pw",
    });
  });

  it("sends an explicit null password when omitted", async () => {
    await api.saveProfile(profile);
    expect(invokeMock).toHaveBeenCalledWith("save_profile", {
      profile,
      password: null,
    });
  });

  it("builds the play_recording call", async () => {
    await api.playRecording("cam", 100, 200);
    expect(invokeMock).toHaveBeenCalledWith("play_recording", {
      camera: "cam",
      start: 100,
      end: 200,
    });
  });
});
