import { AnimatePresence, motion } from "motion/react";
import { Check, Library, Pencil, Play, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Project } from "../../bindings";
import { Modal } from "../../components/Modal";
import { Button, Card, Chip, IconButton, PageHeader } from "../../components/ui";
import { stemColor } from "../../lib/colors";
import { formatBytes, formatDate, formatMusic, formatTime, qualityLabel } from "../../lib/format";
import { backend, toAppError } from "../../lib/ipc";
import { useApp } from "../../store/app";
import { forgetPlayerState, usePlayer } from "../player/playerStore";
import { useT } from "../../i18n/useT";

export function LibraryView() {
  const { t, tn } = useT();
  const projects = useApp((s) => s.projects);
  const refresh = useApp((s) => s.refreshProjects);
  const openProject = useApp((s) => s.openProject);
  const go = useApp((s) => s.go);
  const toast = useApp((s) => s.toast);
  const current = useApp((s) => s.project);
  const retention = useApp((s) => s.settings?.libraryRetentionDays ?? 0);
  const [size, setSize] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<"all" | Project | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Every word must appear somewhere: title, artist, file name, key, tempo or model.
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return projects;
    return projects.filter((p) => {
      const hay = [p.title, p.artist, p.sourceFileName, formatMusic(p.music), p.music?.key?.camelot, p.model.name].filter(Boolean).join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [projects, query]);

  useEffect(() => {
    void refresh();
    void backend().then((b) => b.appInfo()).then((i) => setSize(i.libraryBytes));
  }, [refresh, projects.length]);

  const remove = async (target: "all" | Project) => {
    const b = await backend();
    try {
      if (target === "all") await b.clearCache(true, false);
      else await b.deleteProject(target.id);
      forgetPlayerState(target === "all" ? "all" : target.id);
      if (target === "all" || current?.project.id === target.id) {
        usePlayer.getState().unload();
        useApp.setState({ project: null });
      }
      await refresh();
      toast({ tone: "success", title: target === "all" ? t("Library cleared") : t("Removed “{title}”", { title: target.title }) });
    } catch (e) {
      toast({ tone: "error", title: t("Couldn't remove"), body: toAppError(e).message });
    }
    setConfirm(null);
  };

  return (
    <div className="mx-auto max-w-[1000px] py-10">
      <PageHeader
        title={t("Library")}
        subtitle={
          <>
            {projects.length > 0 &&
              (size != null
                ? tn(
                    "{n} separated song · {size} on disk — reopen instantly, no reprocessing.",
                    "{n} separated songs · {size} on disk — reopen instantly, no reprocessing.",
                    projects.length,
                    { size: formatBytes(size) },
                  )
                : tn("{n} separated song — reopen instantly, no reprocessing.", "{n} separated songs — reopen instantly, no reprocessing.", projects.length)) + " "}
            {retention > 0 ? (
              <button className="text-accent hover:underline" onClick={() => go("settings")} data-tip={t("Change how long songs are kept")} data-shortcut="goSettings">
                {tn("Songs are deleted after {n} day.", "Songs are deleted after {n} days.", retention)}
              </button>
            ) : (
              t("Songs are kept until you delete them.")
            )}
          </>
        }
        right={
          projects.length > 0 && (
            <Button variant="danger" size="sm" icon={<Trash2 size={13} />} onClick={() => setConfirm("all")} tip={t("Delete every cached stem (your songs are untouched)")}>
              {t("Clear library")}
            </Button>
          )
        }
      />

      {projects.length === 0 ? (
        <Card className="flex flex-col items-center px-8 py-14 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-elevated">
            <Library size={24} className="text-muted" />
          </div>
          <div className="font-medium">{t("Nothing here yet")}</div>
          <p className="mt-1 max-w-sm text-sm text-muted">{t("Songs you separate are kept here, so you can come back to the stems without waiting again.")}</p>
          <Button className="mt-6" variant="primary" onClick={() => go("separate")} tip={t("Load a song and split it")} shortcut="goSeparate">
            {t("Separate a song")}
          </Button>
        </Card>
      ) : (
        <>
          {projects.length > 1 && (
            <div className="relative mb-3">
              <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && query && (e.stopPropagation(), setQuery(""))}
                placeholder={t("Search by title, artist, key or BPM")}
                aria-label={t("Search the library")}
                data-tip={t("Type any part of a title, artist, key (e.g. A minor, 8A) or tempo")}
                className="h-9 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-[13px] outline-none placeholder:text-faint focus:border-accent"
              />
            </div>
          )}
          {shown.length === 0 && (
            <p className="card px-4 py-6 text-center text-[13px] text-muted">
              {t("No songs match “{query}”.", { query })}{" "}
              <button className="text-accent hover:underline" onClick={() => setQuery("")}>
                {t("Show all")}
              </button>
            </p>
          )}
          <ul className={shown.length ? "card divide-y divide-[var(--border)] overflow-hidden" : "hidden"}>
            <AnimatePresence initial={false}>
              {shown.map((p, i) => (
                <motion.li
                  key={p.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 10) * 0.03 } }}
                  exit={{ opacity: 0, x: -20 }}
                >
                  <div className="group flex items-center gap-3.5 px-3 py-2.5 pr-3 transition-colors hover:bg-elevated/60">
                    <button
                      onClick={() => openProject(p.id)}
                      aria-label={t("Open {title}", { title: p.title })}
                      data-tip={t("Open in the player")}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent transition-colors hover:bg-accent hover:text-white"
                    >
                      <Play size={15} fill="currentColor" className="ml-0.5" />
                    </button>
                    <div className="min-w-0 flex-1">
                      {editing === p.id ? (
                        <RenameField
                          initial={p.title}
                          onDone={async (title) => {
                            setEditing(null);
                            if (title && title !== p.title) {
                              await (await backend()).renameProject(p.id, title).catch((e) => toast({ tone: "error", title: t("Couldn't rename"), body: toAppError(e).message }));
                              void refresh();
                            }
                          }}
                        />
                      ) : (
                        <button className="block max-w-full truncate text-left text-[13px] font-medium hover:underline" onClick={() => openProject(p.id)} data-tip={t("Open in the player")}>
                          <span className="select-text">{p.title}</span>
                        </button>
                      )}
                      <div className="mt-0.5 truncate text-xs text-muted">
                        {[p.artist, formatTime(p.durationSecs), formatMusic(p.music), formatDate(p.createdAt), `${p.model.name} · ${qualityLabel(p.quality)}`].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <div className="hidden items-center gap-1 md:flex">
                      {p.stems.map((s) => (
                        <span key={s.id} data-tip={s.label} className="h-1.5 w-5 rounded-full" style={{ background: stemColor(s.id, s.color) }} />
                      ))}
                    </div>
                    {current?.project.id === p.id && <Chip color="var(--accent)" tip={t("Currently open in the player")}>{t("Open")}</Chip>}
                    <div className="flex opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                      <IconButton label={t("Rename {title}", { title: p.title })} onClick={() => setEditing(p.id)}>
                        <Pencil size={16} />
                      </IconButton>
                      <IconButton label={t("Delete {title}", { title: p.title })} onClick={() => setConfirm(p)}>
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </>
      )}

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm === "all" ? t("Clear the whole library?") : t("Delete this project?")}>
        <p className="text-sm text-muted">
          {confirm === "all"
            ? t("This deletes every cached stem ({what}). Your original songs aren't touched. This can't be undone.", { what: size != null ? formatBytes(size) : t("all files") })
            : confirm && t("The stems for “{title}” will be deleted. Your original song isn't touched. This can't be undone.", { title: confirm.title })}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)} data-autofocus shortcut="closeDialog" tip={t("Keep everything")}>
            {t("Cancel")}
          </Button>
          <Button variant="danger" onClick={() => confirm && void remove(confirm)} tip={t("Delete permanently")}>
            {confirm === "all" ? t("Clear library") : t("Delete")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function RenameField({ initial, onDone }: { initial: string; onDone: (v: string | null) => void }) {
  const { t } = useT();
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
        aria-label={t("Project title")}
        value={v}
        maxLength={200}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone(null)}
        className="h-8 w-full max-w-sm rounded-lg border border-border bg-surface px-2 text-sm outline-none focus:border-accent"
      />
      <IconButton label={t("Save title")} type="submit">
        <Check size={16} />
      </IconButton>
      <IconButton label={t("Cancel rename")} type="button" onClick={() => onDone(null)}>
        <X size={16} />
      </IconButton>
    </form>
  );
}
