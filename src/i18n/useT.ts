import { useMemo } from "react";
import { useApp } from "../store/app";
import { translate, translateBackend, translateN, type Vars } from "./index";

/** Translation functions for the language chosen in Settings; components re-render when it changes. */
export function useT() {
  const lang = useApp((s) => s.settings?.language ?? "en");
  return useMemo(
    () => ({
      lang,
      t: (text: string, vars?: Vars) => translate(lang, text, vars),
      tn: (one: string, other: string, n: number, vars?: Vars) => translateN(lang, one, other, n, vars),
      /** A status line sent by the engine. */
      tb: (text: string) => translateBackend(lang, text),
    }),
    [lang],
  );
}
