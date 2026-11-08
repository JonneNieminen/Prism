import { Rich } from "../i18n/Rich";

/**
 * Release notes written in Markdown, shown simply: headings, bullet lists and paragraphs, with
 * **bold** and `code`. Links become plain text and anything fancier is left as written.
 */
export function ReleaseNotes({ markdown }: { markdown: string }) {
  const plain = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/<[^>]+>/g, "");
  const blocks: { kind: "h" | "ul" | "p"; lines: string[] }[] = [];
  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      blocks.push({ kind: "p", lines: [] });
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const last = blocks[blocks.length - 1];
    if (heading) blocks.push({ kind: "h", lines: [plain(heading[1])] });
    else if (bullet) {
      if (last?.kind === "ul") last.lines.push(plain(bullet[1]));
      else blocks.push({ kind: "ul", lines: [plain(bullet[1])] });
    } else if (last?.kind === "p") last.lines.push(plain(line.trim()));
    else blocks.push({ kind: "p", lines: [plain(line.trim())] });
  }
  return (
    <div className="space-y-2 text-[13px] leading-relaxed text-text/85 [&_b]:font-semibold [&_b]:text-text [&_code]:rounded [&_code]:bg-elevated [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12px]">
      {blocks
        .filter((b) => b.lines.length > 0)
        .map((b, i) =>
          b.kind === "h" ? (
            <h4 key={i} className="pt-1 text-[13px] font-semibold text-text">
              <Rich text={b.lines[0]} />
            </h4>
          ) : b.kind === "ul" ? (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {b.lines.map((l, j) => (
                <li key={j}>
                  <Rich text={l} />
                </li>
              ))}
            </ul>
          ) : (
            <p key={i}>
              <Rich text={b.lines.join(" ")} />
            </p>
          ),
        )}
    </div>
  );
}
