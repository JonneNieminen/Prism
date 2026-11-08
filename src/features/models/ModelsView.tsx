import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CloudOff, Download, Eye, EyeOff, FolderOpen, Package, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { CatalogEntry, ModelInfo } from "../../bindings";
import { Modal } from "../../components/Modal";
import { Button, Card, Chip, Meter, ProgressBar, PageHeader, Spinner, StemChip } from "../../components/ui";
import { formatBytes } from "../../lib/format";
import { backend, toAppError, type DownloadEvent } from "../../lib/ipc";
import { useApp } from "../../store/app";
import { tr } from "../../i18n";
import { useT } from "../../i18n/useT";

type Dl = { jobId: string; done: number; total: number };

export function ModelsView() {
  const { t } = useT();
  const models = useApp((s) => s.models);
  const settings = useApp((s) => s.settings)!;
  const refresh = useApp((s) => s.refreshModels);
  const update = useApp((s) => s.updateSettings);
  const toast = useApp((s) => s.toast);
  const [catalog, setCatalog] = useState<{ entries: CatalogEntry[]; warnings: string[] } | "loading" | { error: string }>("loading");
  const [downloads, setDownloads] = useState<Record<string, Dl>>({});
  const [importing, setImporting] = useState(false);
  const [removing, setRemoving] = useState<ModelInfo | null>(null);

  const loadCatalog = useCallback(async () => {
    setCatalog("loading");
    try {
      setCatalog(await (await backend()).fetchCatalog());
    } catch (e) {
      setCatalog({ error: toAppError(e).message });
    }
  }, []);

  useEffect(() => {
    void refresh();
    void loadCatalog();
    let off: (() => void) | undefined;
    void backend().then(async (b) => {
      off = await b.onDownload((e: DownloadEvent) => {
        setDownloads((d) => {
          const id = Object.keys(d).find((k) => d[k].jobId === e.jobId);
          if (!id) return d;
          if (e.kind === "progress") return { ...d, [id]: { ...d[id], done: e.done, total: e.total } };
          const { [id]: _gone, ...rest } = d;
          if (e.kind === "done") {
            toast({ tone: "success", title: tr("Model installed"), body: tr("Checksum verified. It's ready to use.") });
            void refresh();
          } else if (e.error.kind !== "cancelled") toast({ tone: "error", title: tr("Download failed"), body: e.error.message });
          return rest;
        });
      });
    });
    return () => off?.();
  }, [refresh, loadCatalog, toast]);

  const install = async (entry: CatalogEntry) => {
    const jobId = `dl-${crypto.randomUUID()}`;
    setDownloads((d) => ({ ...d, [entry.manifest.id]: { jobId, done: 0, total: entry.files.reduce((a, f) => a + f.bytes, 0) } }));
    await (await backend()).installCatalogModel(jobId, entry);
  };

  const importModel = async (kind: "folder" | "zip") => {
    const b = await backend();
    const path = await b.pickModel(kind);
    if (!path) return;
    setImporting(true);
    try {
      const m = await b.importModel(path);
      toast({ tone: "success", title: t("Imported “{name}”", { name: m.name }), body: m.stems.map((s) => s.label).join(", ") });
      await refresh();
    } catch (e) {
      toast({ tone: "error", title: t("Couldn't import the model"), body: toAppError(e).message });
    } finally {
      setImporting(false);
    }
  };

  const installedIds = new Set(models?.listing.models.map((m) => m.manifest.id));
  const hidden = new Set(settings.hiddenModels);

  return (
    <div className="mx-auto max-w-[1000px] py-10">
      <PageHeader
        title={t("Models")}
        subtitle={t("Separation models run locally. Add your own or download more.")}
        right={
          <div className="flex gap-2">
            <Button size="sm" icon={importing ? <Spinner /> : <FolderOpen size={13} />} onClick={() => void importModel("folder")} disabled={importing} tip={t("Add a model folder containing model.json and .onnx weights")}>
              {t("Import folder")}
            </Button>
            <Button size="sm" icon={<Package size={13} />} onClick={() => void importModel("zip")} disabled={importing} tip={t("Add a model packaged as a .zip")}>
              {t("Import .zip")}
            </Button>
          </div>
        }
      />

      <h2 className="mb-3 text-sm font-medium text-muted">{t("Installed")}</h2>
      <div className="grid gap-3">
        {models?.listing.models.map((m, i) => (
          <motion.div key={m.manifest.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
            <ModelCard
              m={m}
              active={models.activeId === m.manifest.id}
              hidden={hidden.has(m.manifest.id)}
              onUse={() => void update({ activeModelId: m.manifest.id })}
              onToggleHidden={() =>
                void update({
                  hiddenModels: hidden.has(m.manifest.id) ? settings.hiddenModels.filter((x) => x !== m.manifest.id) : [...settings.hiddenModels, m.manifest.id],
                  ...(models.activeId === m.manifest.id && !hidden.has(m.manifest.id)
                    ? { activeModelId: models.listing.models.find((x) => x.manifest.id !== m.manifest.id && !x.problem && !hidden.has(x.manifest.id))?.manifest.id ?? m.manifest.id }
                    : {}),
                })
              }
              onRemove={() => setRemoving(m)}
              lastVisible={models.listing.models.filter((x) => !x.problem && !hidden.has(x.manifest.id)).length <= 1}
            />
          </motion.div>
        ))}
        {models?.listing.problems.map((p) => (
          <div key={p.folder} className="card flex items-start gap-3 p-4 text-[13px]">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />
            <div>
              <div className="font-medium">“{p.folder}” couldn't be loaded</div>
              <div className="mt-0.5 text-muted">{p.message}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted">{t("Catalog")}</h2>
        <button className="flex items-center gap-1.5 text-[13px] text-muted hover:text-text" onClick={() => void loadCatalog()} data-tip={t("Reload the model catalog")}>
          <RefreshCw size={13} /> {t("Refresh")}
        </button>
      </div>
      {catalog === "loading" ? (
        <div className="grid gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-surface" />
          ))}
        </div>
      ) : "error" in catalog ? (
        <Card className="flex items-center gap-4 p-5">
          <CloudOff size={22} className="shrink-0 text-muted" />
          <div className="flex-1 text-sm">
            <div className="font-medium">{t("The catalog isn't reachable right now")}</div>
            <div className="mt-0.5 text-muted">{t("Prism works fully offline — this only affects downloading new models.")} {catalog.error}</div>
          </div>
          <Button size="sm" onClick={() => void loadCatalog()} tip={t("Try reaching the catalog again")}>
            {t("Retry")}
          </Button>
        </Card>
      ) : (
        <div className="grid gap-3">
          {catalog.entries.map((e) => {
            const dl = downloads[e.manifest.id];
            const installed = installedIds.has(e.manifest.id);
            return (
              <Card key={e.manifest.id} className="p-5">
                <div className="flex items-start gap-4">
                  <ModelSummary manifest={e.manifest} nonCommercial={!!e.manifest.nonCommercial || /-nc|non-?commercial/i.test(e.manifest.license)} />
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="text-xs text-muted">{formatBytes(e.files.reduce((a, f) => a + f.bytes, 0))}</span>
                    {installed ? (
                      <Chip color="var(--success)" tip={t("Already installed")}>{t("Installed")}</Chip>
                    ) : dl ? (
                      <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => void backend().then((b) => b.cancelJob(dl.jobId))} tip={t("Stop the download. Nothing is installed.")}>
                        {t("Cancel")}
                      </Button>
                    ) : (
                      <Button size="sm" variant="primary" icon={<Download size={13} />} onClick={() => void install(e)} tip={t("Download over HTTPS and verify its checksum before installing")}>
                        {t("Download")}
                      </Button>
                    )}
                  </div>
                </div>
                <AnimatePresence>
                  {dl && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                      <ProgressBar className="mt-4" value={dl.total ? dl.done / dl.total : 0} label={t("Downloading {name}", { name: e.manifest.name })} />
                      <div className="mt-1.5 text-right text-xs text-muted tabular">
                        {t("{done} of {total} · verified with SHA-256 before install", { done: formatBytes(dl.done), total: formatBytes(dl.total) })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Card>
            );
          })}
          {catalog.entries.length === 0 && <p className="text-sm text-muted">{t("The catalog has no models yet.")}</p>}
          {catalog.warnings.length > 0 && <p className="text-xs text-muted">{catalog.warnings.length} catalog entries were skipped because they failed validation.</p>}
        </div>
      )}

      <p className="mt-8 flex items-start gap-2 text-xs leading-relaxed text-muted">
        <ShieldCheck size={14} className="mt-0.5 shrink-0" />
        {t("Prism only runs ONNX models, which can't execute code when loaded. Pickled PyTorch checkpoints (.pt, .th, .ckpt) are refused. Downloads use HTTPS and are checked against their SHA-256 before they can be used.")}
      </p>

      <Modal open={!!removing} onClose={() => setRemoving(null)} title={t("Remove this model?")}>
        <p className="text-sm text-muted">“{removing?.manifest.name}” and its weights ({formatBytes(removing?.sizeBytes ?? 0)}) will be deleted. Songs you already separated with it stay in your library.</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRemoving(null)} data-autofocus shortcut="closeDialog" tip={t("Keep the model")}>
            {t("Cancel")}
          </Button>
          <Button
            variant="danger"
            tip={t("Delete the model and its weights")}
            onClick={async () => {
              const m = removing!;
              setRemoving(null);
              try {
                await (await backend()).removeModel(m.manifest.id);
                await refresh();
                toast({ tone: "success", title: t("Removed “{name}”", { name: m.manifest.name }) });
              } catch (e) {
                toast({ tone: "error", title: t("Couldn't remove the model"), body: toAppError(e).message });
              }
            }}
          >
            {t("Remove")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function ModelSummary({ manifest: m, nonCommercial }: { manifest: CatalogEntry["manifest"]; nonCommercial: boolean }) {
  const { t } = useT();
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{m.name}</span>
        {m.version && <span className="text-xs text-muted">v{m.version}</span>}
        <Chip tip={t("Runs with the {architecture} adapter", { architecture: m.architecture })}>{m.architecture}</Chip>
        {nonCommercial && (
          <Chip color="var(--warning)" tip={t("Its license doesn't allow commercial use of the output")}>
            {t("Non-commercial")}
          </Chip>
        )}
        {m.cpuOnly && (
          <Chip tip={t("Always runs on the CPU: slower than the GPU / Neural Engine, but it can't run out of accelerator memory")}>{t("CPU only")}</Chip>
        )}
      </div>
      {m.description && <p className="mt-1 text-[13px] text-muted">{m.description}</p>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {m.stems.map((s) => (
          <StemChip key={s.id} id={s.id} label={s.label} color={s.color} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted">
        <span>
          {m.license} · {m.author}
        </span>
        {m.hints && (
          <>
            <Meter label={t("Speed")} value={m.hints.speed} />
            <Meter label={t("Quality")} value={m.hints.quality} />
          </>
        )}
      </div>
    </div>
  );
}

function ModelCard({
  m,
  active,
  hidden,
  onUse,
  onToggleHidden,
  onRemove,
  lastVisible,
}: {
  m: ModelInfo;
  active: boolean;
  hidden: boolean;
  lastVisible: boolean;
  onUse: () => void;
  onToggleHidden: () => void;
  onRemove: () => void;
}) {
  const { t } = useT();
  return (
    <Card className="p-5" style={{ opacity: hidden ? 0.6 : 1 }}>
      <div className="flex items-start gap-4">
        <ModelSummary manifest={m.manifest} nonCommercial={m.nonCommercial} />
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex gap-1.5">
            {m.bundled && <Chip tip={t("Ships with Prism and works offline")}>{t("Built-in")}</Chip>}
            {active && <Chip color="var(--accent)" tip={t("Used for new separations")}>{t("Active")}</Chip>}
            {hidden && <Chip>{t("Hidden")}</Chip>}
          </div>
          <span className="text-xs text-muted">{formatBytes(m.sizeBytes)}</span>
          <div className="flex gap-1">
            {!active && !hidden && !m.problem && (
              <Button size="sm" onClick={onUse} tip={t("Make this the model for new separations")}>
                {t("Use")}
              </Button>
            )}
            {m.bundled ? (
              <Button
                size="sm"
                variant="ghost"
                icon={hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                onClick={onToggleHidden}
                disabled={!hidden && lastVisible}
                tip={!hidden && lastVisible ? t("At least one model must stay available") : hidden ? t("Show this model in the model picker") : t("Hide from the model picker (built-in models can't be deleted)")}
              >
                {hidden ? t("Show") : t("Hide")}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={onRemove} aria-label={t("Remove {name}", { name: m.manifest.name })} tip={t("Delete this model and its weights")}>
                {t("Remove")}
              </Button>
            )}
          </div>
        </div>
      </div>
      {m.problem && (
        <div className="mt-3 flex items-center gap-2 text-[13px] text-warning">
          <AlertTriangle size={14} /> {m.problem}
        </div>
      )}
    </Card>
  );
}
