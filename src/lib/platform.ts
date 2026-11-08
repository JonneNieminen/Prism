// Which desktop OS the webview runs on. Tauri uses WKWebView on macOS, WebView2 on
// Windows and WebKitGTK on Linux, so the user agent is a reliable signal.
export type Platform = "mac" | "windows" | "linux";

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "mac";
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const hint = `${nav.userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`.toLowerCase();
  if (hint.includes("mac") || hint.includes("iphone") || hint.includes("ipad")) return "mac";
  if (hint.includes("win")) return "windows";
  return "linux";
}

export const platform: Platform = detectPlatform();
export const isMac = platform === "mac";

/** "this Mac" on macOS, "this computer" elsewhere. */
export const thisComputer = isMac ? "this Mac" : "this computer";
