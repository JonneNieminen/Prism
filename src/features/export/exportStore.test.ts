import { beforeEach, describe, expect, it, vi } from "vitest";

// A hand-driven backend: tests decide when progress arrives and how each export ends.
const progress = new Set<(e: { jobId: string; fraction: number }) => void>();
const cancelJob = vi.fn(async (_id: string) => {});
vi.mock("../../lib/ipc", async (orig) => ({
  ...(await orig<typeof import("../../lib/ipc")>()),
  backend: async () => ({ onExportProgress: async (cb: never) => (progress.add(cb), () => progress.delete(cb)), cancelJob }),
}));

const { useExports } = await import("./exportStore");

type Ctl = { resolve(): void; reject(e: unknown): void; jobId: string };
function startExport(title = "Song") {
  const ctl = {} as Ctl;
  useExports.getState().start({
    title,
    what: { kind: "zip" },
    path: `/out/${title}.zip`,
    run: (_b, jobId) =>
      new Promise<void>((resolve, reject) => {
        Object.assign(ctl, { resolve, reject, jobId });
      }),
  });
  return ctl;
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const job = (id: string) => useExports.getState().jobs.find((j) => j.id === id);
const emit = (jobId: string, fraction: number) => progress.forEach((cb) => cb({ jobId, fraction }));

describe("background exports", () => {
  beforeEach(() => useExports.setState({ jobs: [] }));

  it("runs several at once, each with its own progress, and marks them done", async () => {
    const a = startExport("A");
    const b = startExport("B");
    await flush();
    emit(a.jobId, 0.25);
    emit(b.jobId, 0.6);
    emit(a.jobId, 0.1); // late, out-of-order event: ignored
    expect(job(a.jobId)?.fraction).toBe(0.25);
    expect(job(b.jobId)?.fraction).toBe(0.6);
    expect(useExports.getState().jobs.map((j) => j.title)).toEqual(["B", "A"]);

    a.resolve();
    await flush();
    expect(job(a.jobId)).toMatchObject({ status: "done", fraction: 1 });
    expect(job(b.jobId)?.status).toBe("running");
    emit(a.jobId, 0.5); // after it ended: ignored
    expect(job(a.jobId)?.fraction).toBe(1);
  });

  it("keeps a failure with its message and retries it as a new run", async () => {
    const a = startExport();
    await flush();
    a.reject({ kind: "io", message: "The disk is full." });
    await flush();
    const first = a.jobId;
    expect(job(first)).toMatchObject({ status: "failed", error: "The disk is full." });

    useExports.getState().retry(first);
    await flush();
    const [again] = useExports.getState().jobs;
    expect(useExports.getState().jobs).toHaveLength(1);
    expect(again).toMatchObject({ status: "running", fraction: 0, error: null, title: "Song" });
    expect(again.id).not.toBe(first);
  });

  it("drops a cancelled export from the list", async () => {
    const a = startExport();
    await flush();
    await useExports.getState().cancel(a.jobId);
    expect(cancelJob).toHaveBeenCalledWith(a.jobId);
    a.reject({ kind: "cancelled", message: "Cancelled" });
    await flush();
    expect(useExports.getState().jobs).toEqual([]);
  });

  it("clears and caps finished exports but never touches running ones", async () => {
    const running = startExport("running");
    for (let i = 0; i < 7; i++) {
      const c = startExport(`done ${i}`);
      await flush();
      c.resolve();
      await flush();
    }
    const finished = useExports.getState().jobs.filter((j) => j.status === "done");
    expect(finished.map((j) => j.title)).toEqual(["done 6", "done 5", "done 4", "done 3", "done 2"]);

    useExports.getState().dismiss(running.jobId);
    expect(job(running.jobId)).toBeDefined();
    useExports.getState().clearFinished();
    expect(useExports.getState().jobs.map((j) => j.title)).toEqual(["running"]);
  });
});
