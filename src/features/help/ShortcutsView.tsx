import { Card, GroupLabel, Keys, PageHeader } from "../../components/ui";
import { SHORTCUTS, type Group } from "../../lib/shortcuts";

const GROUPS: { group: Group; note?: string }[] = [
  { group: "General" },
  { group: "Navigation" },
  { group: "Player", note: "In the player, when you're not typing in a field." },
  { group: "Stems", note: "Stems are numbered top to bottom in the player." },
  { group: "Window" },
];

export function ShortcutsView() {
  return (
    <div className="mx-auto max-w-[860px] py-8">
      <PageHeader title="Keyboard shortcuts" subtitle="Everything in Prism can be done from the keyboard. Hover any button to see its shortcut." />
      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
        {GROUPS.map(({ group, note }) => (
          <section key={group}>
            <GroupLabel>{group}</GroupLabel>
            <Card className="divide-y divide-[var(--border)] px-4">
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <div key={s.id} className="flex h-10 items-center justify-between gap-4">
                  <span className="text-[13px]">{s.label}</span>
                  <Keys keys={s.keys} />
                </div>
              ))}
            </Card>
            {note && <p className="mt-1.5 px-1 text-[11px] text-faint">{note}</p>}
          </section>
        ))}
      </div>
    </div>
  );
}
