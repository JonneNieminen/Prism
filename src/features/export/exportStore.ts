import { create } from "zustand";
import { backend, toAppError, type Backend } from "../../lib/ipc";

/** What one export writes, for its label in the Exports panel. */
export type ExportWhat = { kind: "mix" } | { kind: "zip" } | { kind: "stem"; stemLabel: string };
export type ExportStatus = "running" | "done" | "failed";

export type ExportJob = {
  id: string;
  title: string;
  what: ExportWhat;
  path: string;
  fraction: number;
  status: ExportStatus;
  error: string | null;
  /** Starts (or restarts) the export under the given job id. */
  run: (b: Backend, jobId: string) => Promise<void>;
};

export type ExportRequest = Pick<ExportJob, "title" | "what" | "path" | "run">;

type State = {
  /** Newest first. Finished ones stay until dismissed (only the latest few are kept). */
  jobs: ExportJob[];
  /** Runs an export in the background; the Exports panel in the sidebar shows it. */
  start(req: ExportRequest): void;
  cancel(id: string): Promise<void>;
  retry(id: string): void;
  dismiss(id: string): void;
  clearFinished(): void;
};

/** Finished exports kept in the panel; older ones drop off. */
const KEEP_FINISHED = 5;

const patch = (id: string, p: Partial<ExportJob>) => useExports.setState((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...p } : j)) }));

/** Keeps every running export plus the newest finished ones. */
function trim(jobs: ExportJob[]) {
  let finished = 0;
  return jobs.filter((j) => j.status === "running" || ++finished <= KEEP_FINISHED);
}

let listening: Promise<void> | null = null;
function listen() {
  listening ??= backend().then(async (b) => {
    await b.onExportProgress((e) => {
      const j = useExports.getState().jobs.find((x) => x.id === e.jobId);
      // Events can arrive after the job ended; only a running one moves, and only forward.
      if (j?.status === "running" && e.fraction > j.fraction) patch(e.jobId, { fraction: e.fraction });
    });
  });
  return listening;
}

async function execute(job: ExportJob) {
  await listen();
  const b = await backend();
  try {
    await job.run(b, job.id);
    patch(job.id, { status: "done", fraction: 1 });
  } catch (e) {
    const err = toAppError(e);
    if (err.kind === "cancelled") useExports.setState((s) => ({ jobs: s.jobs.filter((j) => j.id !== job.id) }));
    else patch(job.id, { status: "failed", error: err.message });
  }
  useExports.setState((s) => ({ jobs: trim(s.jobs) }));
}

const newId = () => `export-${crypto.randomUUID()}`;

export const useExports = create<State>((set, get) => ({
  jobs: [],
  start(req) {
    const job: ExportJob = { ...req, id: newId(), fraction: 0, status: "running", error: null };
    set({ jobs: [job, ...get().jobs] });
    void execute(job);
  },
  async cancel(id) {
    await (await backend()).cancelJob(id);
  },
  retry(id) {
    const old = get().jobs.find((j) => j.id === id);
    if (!old || old.status !== "failed") return;
    set({ jobs: get().jobs.filter((j) => j.id !== id) });
    get().start({ title: old.title, what: old.what, path: old.path, run: old.run });
  },
  dismiss: (id) => set({ jobs: get().jobs.filter((j) => j.id !== id || j.status === "running") }),
  clearFinished: () => set({ jobs: get().jobs.filter((j) => j.status === "running") }),
}));
