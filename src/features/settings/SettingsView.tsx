import { FolderOpen, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ExportFormat, Quality, Theme } from "../../bindings";
import { Button, Card, Field, GroupLabel, PageHeader, Segmented, Switch } from "../../components/ui";
import { formatBytes, QUALITY_LABEL } from "../../lib/format";
import { backend, toAppError, type AppInfo } from "../../lib/ipc";
import { useApp } from "../../store/app";
import { usePlayer } from "../player/playerStore";

const RETENTION_CHOICES = [1, 3, 7, 14, 30, 90, 0];

export function SettingsView() {
  const settings = useApp((s) => s.settings)!;
  const models = useApp((s) => s.models);
  const update = useApp((s) => s.updateSettings);
  const toast = useApp((s) => s.toast);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [url, setUrl] = useState(settings.catalogUrl);
  const loadInfo = () => void backend().then((b) => b.appInfo()).then(setInfo);
  useEffect(loadInfo, []);

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
      toast({ tone: "success", title: library ? "Library cleared" : "Accelerator cache cleared" });
      loadInfo();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't clear the cache", body: toAppError(e).message });
    }
  };

  return (
    <div className="mx-auto max-w-[760px] py-10">
      <PageHeader title="Settings" subtitle="Prism remembers these between launches." />

      <Group title="Separation">
        <Field label="Active model" hint="Used by default for new separations.">
          <select
            aria-label="Active model"
            value={settings.activeModelId}
            onChange={(e) => void update({ activeModelId: e.target.value })}
            data-tip="Model used for new separations"
            className="h-7 rounded-md border border-border bg-elevated px-2 text-[13px] outline-none"
          >
            {usable.map((m) => (
              <option key={m.manifest.id} value={m.manifest.id}>
                {m.manifest.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Default quality" hint="Best runs several passes and takes longer.">
          <Segmented<Quality>
            label="Default quality"
            value={settings.quality}
            onChange={(v) => void update({ quality: v })}
            options={(["fast", "balanced", "best"] as Quality[]).map((v) => ({ value: v, label: QUALITY_LABEL[v] }))}
          />
        </Field>
        <Field label="Hardware acceleration" hint="Use the Apple Silicon GPU / Neural Engine via Core ML. Falls back to CPU automatically.">
          <Switch label="Hardware acceleration" tip="On: GPU / Neural Engine (faster). Off: CPU only." checked={settings.acceleration === "auto"} onChange={(v) => void update({ acceleration: v ? "auto" : "cpu" })} />
        </Field>
      </Group>

      <Group title="Export">
        <Field label="Format">
          <Segmented<ExportFormat>
            label="Export format"
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
          <Field label="MP3 bitrate">
            <Segmented
              label="MP3 bitrate"
              size="sm"
              value={String(settings.mp3Bitrate)}
              onChange={(v) => void update({ mp3Bitrate: Number(v) })}
              options={["128", "192", "256", "320"].map((v) => ({ value: v, label: v }))}
            />
          </Field>
        )}
        <Field label="Default save folder" hint={settings.defaultSaveDir ?? "Ask every time (starts in your last folder)."}>
          <div className="flex gap-2">
            {settings.defaultSaveDir && (
              <Button size="sm" variant="ghost" onClick={() => void update({ defaultSaveDir: null })} tip="Ask where to save each time">
                Clear
              </Button>
            )}
            <Button
              size="sm"
              icon={<FolderOpen size={13} />}
              onClick={async () => {
                const p = await (await backend()).pickFolder();
                if (p) void update({ defaultSaveDir: p });
              }}
              tip="Pick a folder to start every save dialog in"
            >
              Choose…
            </Button>
          </div>
        </Field>
      </Group>

      <Group title="Appearance">
        <Field label="Appearance" hint="Also in the sidebar, or press ⇧⌘L to switch light / dark.">
          <Segmented<Theme>
            label="Theme"
            value={settings.theme}
            onChange={(v) => void update({ theme: v })}
            options={[
              { value: "system", label: "System", tip: "Follow macOS" },
              { value: "light", label: "Light", tip: "Always light", shortcut: "toggleTheme" },
              { value: "dark", label: "Dark", tip: "Always dark", shortcut: "toggleTheme" },
            ]}
          />
        </Field>
      </Group>

      <Group title="Storage">
        <Field label="Delete old songs" hint="Separated songs are removed from the library after this long.">
          <select
            aria-label="Delete old songs after"
            value={settings.libraryRetentionDays}
            onChange={(e) => void update({ libraryRetentionDays: Number(e.target.value) })}
            data-tip="How long separated songs stay in the library"
            className="h-7 rounded-md border border-border bg-elevated px-2 text-[13px] outline-none"
          >
            {[...new Set([...RETENTION_CHOICES, settings.libraryRetentionDays])]
              .sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b))
              .map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? "Never" : d === 1 ? "After 1 day" : `After ${d} days`}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Library" hint={info ? `${formatBytes(info.libraryBytes)} of cached stems` : "…"}>
          <Button size="sm" variant="danger" icon={<Trash2 size={13} />} onClick={() => void clear(true, false)} disabled={!info?.libraryBytes} tip="Delete all separated stems. Your songs are untouched.">
            Clear
          </Button>
        </Field>
        <Field label="Accelerator cache" hint={info ? `${formatBytes(info.accelCacheBytes)} of compiled models — rebuilt on next use` : "…"}>
          <Button size="sm" variant="danger" icon={<Trash2 size={13} />} onClick={() => void clear(false, true)} disabled={!info?.accelCacheBytes} tip="Free space; the next separation re-optimizes the model (about a minute)">
            Clear
          </Button>
        </Field>
        <Field label="Data folder" hint={info?.dataDir}>
          <Button size="sm" onClick={() => info && void backend().then((b) => b.reveal(info.dataDir))} tip="Open the folder with your library and models">
            Show in Finder
          </Button>
        </Field>
      </Group>

      <Group title="Model catalog">
        <div className="py-4">
          <label htmlFor="catalog-url" className="text-sm font-medium">
            Catalog URL
          </label>
          <p className="mt-0.5 text-[13px] text-muted">A JSON index of downloadable models. Must use HTTPS.</p>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (urlValid) void update({ catalogUrl: url.trim() }).then(() => toast({ tone: "success", title: "Catalog URL saved" }));
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
            <Button size="sm" type="submit" disabled={!urlValid || url === settings.catalogUrl} tip="Use this catalog in the Models screen">
              Save
            </Button>
          </form>
        </div>
      </Group>

      <p className="mt-8 text-center text-xs text-muted">Prism {info?.version} · Everything runs locally. No accounts, no uploads.</p>
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
