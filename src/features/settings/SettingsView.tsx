import { FolderOpen, FolderSearch, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ExportFormat, Language, Quality, Theme } from "../../bindings";
import { Button, Card, Field, GroupLabel, PageHeader, Segmented, Switch } from "../../components/ui";
import { formatBytes, qualityLabel } from "../../lib/format";
import { backend, toAppError, type AppInfo } from "../../lib/ipc";
import { showInFileManager } from "../../lib/platform";
import { keysFor } from "../../lib/shortcuts";
import { useApp } from "../../store/app";
import { usePlayer } from "../player/playerStore";
import { LANGUAGES, tr } from "../../i18n";
import { useT } from "../../i18n/useT";

const RETENTION_CHOICES = [1, 3, 7, 14, 30, 90, 0];

/** Open a folder in the file manager, saying so if it can't be opened. */
async function openFolder(path: string, create: boolean) {
  try {
    await (await backend()).openFolder(path, create);
  } catch (e) {
    useApp.getState().toast({ tone: "error", title: tr("Couldn't open the folder"), body: toAppError(e).message });
  }
}

export function SettingsView() {
  const { t, tn, lang } = useT();
  const settings = useApp((s) => s.settings)!;
  const models = useApp((s) => s.models);
  const update = useApp((s) => s.updateSettings);
  const toast = useApp((s) => s.toast);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [url, setUrl] = useState(settings.catalogUrl);
  const loadInfo = () => void backend().then((b) => b.appInfo()).then(setInfo);
  useEffect(loadInfo, []);
  const [dlDir, setDlDir] = useState<string | null>(null);
  useEffect(() => {
    void backend().then((b) => b.trackDownloadDir()).then(setDlDir).catch(() => setDlDir(null));
  }, [settings.trackDownloadDir]);

  const usable = (models?.listing.models ?? []).filter((m) => !m.problem && !settings.hiddenModels.includes(m.manifest.id));
  const urlValid = /^https:\/\/\S+$/.test(url);

  const clear = async (library: boolean, accelerator: boolean) => {
    try {
      await (await backend()).clearCache(library, accelerator);
      if (library) {
        usePlayer.getState().unload();
        useApp.setState({ project: null });
        await useApp.getState().refreshProjects();
      }
      toast({ tone: "success", title: library ? t("Library cleared") : t("Accelerator cache cleared") });
      loadInfo();
    } catch (e) {
      toast({ tone: "error", title: t("Couldn't clear the cache"), body: toAppError(e).message });
    }
  };

  return (
    <div className="mx-auto max-w-[760px] py-10">
      <PageHeader title={t("Settings")} subtitle={t("Prism remembers these between launches.")} />

      <Group title={t("Separation")}>
        <Field label={t("Active model")} hint={t("Used by default for new separations.")}>
          <select
            aria-label={t("Active model")}
            value={settings.activeModelId}
            onChange={(e) => void update({ activeModelId: e.target.value })}
            data-tip={t("Model used for new separations")}
            className="h-7 rounded-md border border-border bg-elevated px-2 text-[13px] outline-none"
          >
            {usable.map((m) => (
              <option key={m.manifest.id} value={m.manifest.id}>
                {m.manifest.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Default quality")} hint={t("Best runs several passes and takes longer.")}>
          <Segmented<Quality>
            label={t("Default quality")}
            value={settings.quality}
            onChange={(v) => void update({ quality: v })}
            options={(["fast", "balanced", "best"] as Quality[]).map((v) => ({ value: v, label: qualityLabel(v) }))}
          />
        </Field>
        <Field label={t("Hardware acceleration")} hint={t("Use the Apple Silicon GPU / Neural Engine via Core ML. Falls back to CPU automatically.")}>
          <Switch label={t("Hardware acceleration")} tip={t("On: GPU / Neural Engine (faster). Off: CPU only.")} checked={settings.acceleration === "auto"} onChange={(v) => void update({ acceleration: v ? "auto" : "cpu" })} />
        </Field>
      </Group>

      <Group title={t("Export")}>
        <Field label={t("Format")}>
          <Segmented<ExportFormat>
            label={t("Export format")}
            value={settings.exportFormat}
            onChange={(v) => void update({ exportFormat: v })}
            options={[
              { value: "wav", label: "WAV" },
              { value: "flac", label: "FLAC" },
              { value: "mp3", label: "MP3" },
            ]}
          />
        </Field>
        {settings.exportFormat === "mp3" && (
          <Field label={t("MP3 bitrate")}>
            <Segmented
              label={t("MP3 bitrate")}
              size="sm"
              value={String(settings.mp3Bitrate)}
              onChange={(v) => void update({ mp3Bitrate: Number(v) })}
              options={["128", "192", "256", "320"].map((v) => ({ value: v, label: v }))}
            />
          </Field>
        )}
        <Field label={t("Default save folder")} hint={settings.defaultSaveDir ?? t("Ask every time (starts in your last folder).")}>
          <div className="flex gap-2">
            {settings.defaultSaveDir && (
              <Button size="sm" variant="ghost" onClick={() => void update({ defaultSaveDir: null })} tip={t("Ask where to save each time")}>
                {t("Clear")}
              </Button>
            )}
            {settings.defaultSaveDir && (
              <Button size="sm" icon={<FolderSearch size={13} />} onClick={() => void openFolder(settings.defaultSaveDir!, false)} tip={t("Open this folder in your file manager")}>
                {t(showInFileManager)}
              </Button>
            )}
            <Button
              size="sm"
              icon={<FolderOpen size={13} />}
              onClick={async () => {
                const p = await (await backend()).pickFolder();
                if (p) void update({ defaultSaveDir: p });
              }}
              tip={t("Pick a folder to start every save dialog in")}
            >
              {t("Choose…")}
            </Button>
          </div>
        </Field>
      </Group>

      <Group title={t("Downloads")}>
        <Field label={t("Track download folder")} hint={settings.trackDownloadDir ? dlDir : t("{path} (default)", { path: dlDir ?? "Downloads/Prism" })}>
          <div className="flex gap-2">
            {settings.trackDownloadDir && (
              <Button size="sm" variant="ghost" onClick={() => void update({ trackDownloadDir: null })} tip={t("Go back to the Prism folder inside Downloads")}>
                {t("Reset")}
              </Button>
            )}
            <Button size="sm" icon={<FolderSearch size={13} />} onClick={() => dlDir && void openFolder(dlDir, true)} disabled={!dlDir} tip={t("Open the download folder in your file manager (it's created if it doesn't exist yet)")}>
              {t(showInFileManager)}
            </Button>
            <Button
              size="sm"
              icon={<FolderOpen size={13} />}
              onClick={async () => {
                const p = await (await backend()).pickFolder();
                if (p) void update({ trackDownloadDir: p });
              }}
              tip={t("Pick the folder tracks from Download track are saved to")}
            >
              {t("Choose…")}
            </Button>
          </div>
        </Field>
      </Group>

      <Group title={t("Appearance")}>
        <Field label={t("Appearance")} hint={t("Also in the sidebar, or press {keys} to switch light / dark.", { keys: keysFor("toggleTheme") ?? "" })}>
          <Segmented<Theme>
            label={t("Theme")}
            value={settings.theme}
            onChange={(v) => void update({ theme: v })}
            options={[
              { value: "system", label: t("System"), tip: t("Follow the system") },
              { value: "light", label: t("Light"), tip: t("Always light"), shortcut: "toggleTheme" },
              { value: "dark", label: t("Dark"), tip: t("Always dark"), shortcut: "toggleTheme" },
            ]}
          />
        </Field>
        <Field label={t("Language")} hint={t("Menus, buttons and help. English is the default.")}>
          <Segmented<Language>
            label={t("Language")}
            value={lang}
            onChange={(v) => void update({ language: v })}
            options={LANGUAGES.map((l) => ({ value: l.id, label: l.name, tip: l.name }))}
          />
        </Field>
      </Group>

      <Group title={t("Storage")}>
        <Field label={t("Delete old songs")} hint={t("Separated songs are removed from the library after this long.")}>
          <select
            aria-label={t("Delete old songs after")}
            value={settings.libraryRetentionDays}
            onChange={(e) => void update({ libraryRetentionDays: Number(e.target.value) })}
            data-tip={t("How long separated songs stay in the library")}
            className="h-7 rounded-md border border-border bg-elevated px-2 text-[13px] outline-none"
          >
            {[...new Set([...RETENTION_CHOICES, settings.libraryRetentionDays])]
              .sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b))
              .map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? t("Never") : tn("After {n} day", "After {n} days", d)}
                </option>
              ))}
          </select>
        </Field>
        <Field label={t("Library")} hint={info ? t("{size} of cached stems", { size: formatBytes(info.libraryBytes) }) : "…"}>
          <Button size="sm" variant="danger" icon={<Trash2 size={13} />} onClick={() => void clear(true, false)} disabled={!info?.libraryBytes} tip={t("Delete all separated stems. Your songs are untouched.")}>
            {t("Clear")}
          </Button>
        </Field>
        <Field label={t("Accelerator cache")} hint={info ? t("{size} of compiled models — rebuilt on next use", { size: formatBytes(info.accelCacheBytes) }) : "…"}>
          <Button size="sm" variant="danger" icon={<Trash2 size={13} />} onClick={() => void clear(false, true)} disabled={!info?.accelCacheBytes} tip={t("Free space; the next separation re-optimizes the model (about a minute)")}>
            {t("Clear")}
          </Button>
        </Field>
        <Field label={t("Data folder")} hint={info?.dataDir}>
          <Button size="sm" icon={<FolderSearch size={13} />} onClick={() => info && void openFolder(info.dataDir, false)} tip={t("Open the folder with your library and models")}>
            {t(showInFileManager)}
          </Button>
        </Field>
      </Group>

      <Group title={t("Model catalog")}>
        <div className="py-4">
          <label htmlFor="catalog-url" className="text-sm font-medium">
            {t("Catalog URL")}
          </label>
          <p className="mt-0.5 text-[13px] text-muted">{t("A JSON index of downloadable models. Must use HTTPS.")}</p>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (urlValid) void update({ catalogUrl: url.trim() }).then(() => toast({ tone: "success", title: t("Catalog URL saved") }));
            }}
          >
            <input
              id="catalog-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              spellCheck={false}
              aria-invalid={!urlValid}
              className="h-9 flex-1 rounded-md border border-border bg-elevated px-2.5 font-mono text-[12px] outline-none focus-visible:border-accent aria-[invalid=true]:border-danger"
            />
            <Button size="sm" type="submit" disabled={!urlValid || url === settings.catalogUrl} tip={t("Use this catalog in the Models screen")}>
              {t("Save")}
            </Button>
          </form>
        </div>
      </Group>

      <p className="mt-8 text-center text-xs text-muted">{t("Prism {version} · Everything runs locally. No accounts, no uploads.", { version: info?.version ?? "" })}</p>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <GroupLabel>{title}</GroupLabel>
      <Card className="divide-y divide-[var(--border)] px-4">{children}</Card>
    </section>
  );
}
