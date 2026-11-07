import { AnimatePresence, motion } from "motion/react";
import { Check, Library, Pencil, Play, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Project } from "../../bindings";
import { Modal } from "../../components/Modal";
import { Button, Card, Chip, IconButton, SectionTitle } from "../../components/ui";
import { stemColor } from "../../lib/colors";
import { formatBytes, formatDate, formatTime, QUALITY_LABEL } from "../../lib/format";
import { backend, toAppError } from "../../lib/ipc";
import { useApp } from "../../store/app";
import { usePlayer } from "../player/playerStore";

export function LibraryView() {
  const projects = useApp((s) => s.projects);
  const refresh = useApp((s) => s.refreshProjects);
  const openProject = useApp((s) => s.openProject);
  const go = useApp((s) => s.go);
  const toast = useApp((s) => s.toast);
  const current = useApp((s) => s.project);
  const [size, setSize] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<"all" | Project | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
    void backend().then((b) => b.appInfo()).then((i) => setSize(i.libraryBytes));
  }, [refresh, projects.length]);

  const remove = async (target: "all" | Project) => {
    const b = await backend();
    try {
      if (target === "all") await b.clearCache(true, false);
      else await b.deleteProject(target.id);
      if (target === "all" || current?.project.id === target.id) {
        usePlayer.getState().unload();
        useApp.setState({ project: null });
      }
      await refresh();
      toast({ tone: "success", title: target === "all" ? "Library cleared" : `Removed “${target.title}”` });
    } catch (e) {
      toast({ tone: "error", title: "Couldn't remove", body: toAppError(e).message });
    }
    setConfirm(null);
  };

  return (
    <div className="mx-auto max-w-[1000px] py-10">
      <SectionTitle
        title="Library"
        subtitle={
          projects.length
            ? `${projects.length} separated ${projects.length === 1 ? "song" : "songs"}${size != null ? ` · ${formatBytes(size)} on disk` : ""} — reopen instantly, no reprocessing.`
            : undefined
        }
        right={
          projects.length > 0 && (
            <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={() => setConfirm("all")}>
              Clear library
            </Button>
          )
        }
      />

      {projects.length === 0 ? (
        <Card className="flex flex-col items-center px-8 py-16 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-elevated">
            <Library size={24} className="text-muted" />
          </div>
          <div className="font-medium">Nothing here yet</div>
          <p className="mt-1 max-w-sm text-sm text-muted">Songs you separate are kept here, so you can come back to the stems without waiting again.</p>
          <Button className="mt-6" variant="primary" onClick={() => go("separate")}>
            Separate a song
          </Button>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {projects.map((p, i) => (
              <motion.li
                key={p.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 10) * 0.03 } }}
                exit={{ opacity: 0, x: -20 }}
              >
                <div className="glass group flex items-center gap-4 rounded-2xl p-3 pr-4 transition-colors hover:border-border">
                  <button
                    onClick={() => openProject(p.id)}
                    aria-label={`Open ${p.title}`}
                    className="brand-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white opacity-90 transition group-hover:opacity-100"
                  >
                    <Play size={18} fill="currentColor" className="ml-0.5" />
                  </button>
                  <div className="min-w-0 flex-1">
                    {editing === p.id ? (
                      <RenameField
                        initial={p.title}
                        onDone={async (title) => {
                          setEditing(null);
                          if (title && title !== p.title) {
                            await (await backend()).renameProject(p.id, title).catch((e) => toast({ tone: "error", title: "Couldn't rename", body: toAppError(e).message }));
                            void refresh();
                          }
                        }}
                      />
                    ) : (
                      <button className="block max-w-full truncate text-left text-[15px] font-medium hover:underline" onClick={() => openProject(p.id)}>
                        {p.title}
                      </button>
                    )}
                    <div className="mt-0.5 truncate text-xs text-muted">
                      {[p.artist, formatTime(p.durationSecs), formatDate(p.createdAt), `${p.model.name} · ${QUALITY_LABEL[p.quality]}`].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="hidden items-center gap-1 md:flex">
                    {p.stems.map((s) => (
                      <span key={s.id} title={s.label} className="h-2 w-6 rounded-full" style={{ background: stemColor(s.id, s.color) }} />
                    ))}
                  </div>
                  {current?.project.id === p.id && <Chip color="var(--brand-to)">Open</Chip>}
                  <div className="flex opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    <IconButton label={`Rename ${p.title}`} onClick={() => setEditing(p.id)}>
                      <Pencil size={16} />
                    </IconButton>
                    <IconButton label={`Delete ${p.title}`} onClick={() => setConfirm(p)}>
                      <Trash2 size={16} />
                    </IconButton>
                  </div>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm === "all" ? "Clear the whole library?" : "Delete this project?"}>
        <p className="text-sm text-muted">
          {confirm === "all"
            ? `This deletes every cached stem (${size != null ? formatBytes(size) : "all files"}). Your original songs aren't touched. This can't be undone.`
            : confirm && `The stems for “${confirm.title}” will be deleted. Your original song isn't touched. This can't be undone.`}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)} data-autofocus>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => confirm && void remove(confirm)}>
            {confirm === "all" ? "Clear library" : "Delete"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function RenameField({ initial, onDone }: { initial: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(initial);
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        onDone(v.trim());
      }}
    >
      <input
        autoFocus
        aria-label="Project title"
        value={v}
        maxLength={200}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone(null)}
        className="h-8 w-full max-w-sm rounded-lg border border-border bg-surface px-2 text-sm outline-none focus:border-[var(--brand-from)]"
      />
      <IconButton label="Save title" type="submit">
        <Check size={16} />
      </IconButton>
      <IconButton label="Cancel rename" type="button" onClick={() => onDone(null)}>
        <X size={16} />
      </IconButton>
    </form>
  );
}
