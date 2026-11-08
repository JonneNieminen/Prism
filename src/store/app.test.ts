import { beforeEach, describe, expect, it } from "vitest";
import { useApp, type Job } from "./app";

const runningJob: Job = {
  id: "job-1",
  stage: "separating",
  fraction: 0.4,
  eta: null,
  device: null,
  detail: null,
  note: null,
  startedAt: 0,
  title: "Current",
  modelId: "htdemucs",
  modelName: "Demucs",
};

describe("separation queue", () => {
  beforeEach(() => useApp.setState({ job: runningJob, queue: [], source: { path: "/m/current.mp3", probe: {} as never }, probing: null, toasts: [] }));

  it("queues every dropped song while a separation runs, without duplicates", () => {
    useApp.getState().addSongs(["/m/a.mp3", "C:\\Music\\b.flac", "/m/a.mp3", "/m/current.mp3"]);
    expect(useApp.getState().queue).toEqual([
      { path: "/m/a.mp3", name: "a.mp3" },
      { path: "C:\\Music\\b.flac", name: "b.flac" },
    ]);
    useApp.getState().addSongs(["/m/a.mp3"]);
    expect(useApp.getState().queue).toHaveLength(2);
  });

  it("removes one song or clears them all", () => {
    useApp.getState().addSongs(["/m/a.mp3", "/m/b.mp3", "/m/c.mp3"]);
    useApp.getState().removeFromQueue("/m/b.mp3");
    expect(useApp.getState().queue.map((q) => q.name)).toEqual(["a.mp3", "c.mp3"]);
    useApp.getState().clearQueue();
    expect(useApp.getState().queue).toEqual([]);
  });

  it("does not start the next song while one is running", async () => {
    useApp.getState().addSongs(["/m/a.mp3"]);
    await useApp.getState().startNext();
    expect(useApp.getState().queue).toHaveLength(1);
  });
});
