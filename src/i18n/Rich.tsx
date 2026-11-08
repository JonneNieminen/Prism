import { Keys } from "../components/ui";
import { capsOf } from "../lib/shortcuts";

/**
 * Renders a translated string with **bold**, `code`, and {key:mod+O} keycaps. Keycaps are written
 * with the platform-neutral tokens from the shortcut table and shown for the current OS.
 */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\{key:[^}]+\})/g).map((part, i) =>
        part.startsWith("**") ? (
          <b key={i}>{part.slice(2, -2)}</b>
        ) : part.startsWith("*") ? (
          <em key={i}>{part.slice(1, -1)}</em>
        ) : part.startsWith("`") ? (
          <code key={i}>{part.slice(1, -1)}</code>
        ) : part.startsWith("{key:") ? (
          <Keys key={i} keys={capsOf(part.slice(5, -1).split("+"))} />
        ) : (
          part
        ),
      )}
    </>
  );
}
