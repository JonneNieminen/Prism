import { Card, GroupLabel, Keys, PageHeader } from "../../components/ui";
import { capsOf, SHORTCUTS, type Group } from "../../lib/shortcuts";
import { mark } from "../../i18n";
import { useT } from "../../i18n/useT";

const GROUP_NAMES: Record<Group, string> = {
  General: mark("General"),
  Navigation: mark("Navigation"),
  "Master volume": mark("Master volume"),
  Player: mark("Player"),
  Stems: mark("Stems"),
  Window: mark("Window"),
};

const GROUPS: { group: Group; note?: string }[] = [
  { group: "General" },
  { group: "Navigation" },
  { group: "Master volume", note: mark("Applies to everything Prism plays, in every view. The slider is in the sidebar.") },
  { group: "Player", note: mark("In the player, when you're not typing in a field.") },
  { group: "Stems", note: mark("Stems are numbered top to bottom in the player.") },
  { group: "Window" },
];

export function ShortcutsView() {
  const { t } = useT();
  return (
    <div className="mx-auto max-w-[860px] py-8">
      <PageHeader title={t("Keyboard shortcuts")} subtitle={t("Everything in Prism can be done from the keyboard. Hover any button to see its shortcut.")} />
      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
        {GROUPS.map(({ group, note }) => (
          <section key={group}>
            <GroupLabel>{t(GROUP_NAMES[group])}</GroupLabel>
            <Card className="divide-y divide-[var(--border)] px-4">
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <div key={s.id} className="flex h-10 items-center justify-between gap-4">
                  <span className="text-[13px]">{t(s.label)}</span>
                  <Keys keys={capsOf(s.keys)} />
                </div>
              ))}
            </Card>
            {note && <p className="mt-1.5 px-1 text-[11px] text-faint">{t(note)}</p>}
          </section>
        ))}
      </div>
    </div>
  );
}
