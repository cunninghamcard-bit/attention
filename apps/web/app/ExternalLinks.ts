/**
 * Input: ../views/workspace/Workspace
 * Output: OpenUrlDetail, openExternalUrl, installExternalLinkHandler
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import type { PaneType } from "../views/workspace/Workspace";

export interface OpenUrlDetail {
  url: string;
  leaf: PaneType;
  active: boolean;
}

/**
 * Obsidian's external-link contract (`app.js`: Web viewer's `handleOpenUrl`).
 *
 * A cancelable `open-url` event goes out on `window` first. The Web viewer core
 * plugin claims it while "Open external URLs" is on and loads the page in-app;
 * with the plugin off, or the option off, nothing calls `preventDefault` and the
 * URL falls through to `window.open` — which the main process turns into
 * `shell.openExternal` (see `denyChildWindows`). Those two settings are the
 * whole in-app-vs-system-browser switch; no third destination exists.
 */
export function openExternalUrl(
  url: string,
  options: { leaf?: PaneType; active?: boolean; win?: Window } = {},
): void {
  const win = options.win ?? window;
  const event = new CustomEvent<OpenUrlDetail>("open-url", {
    detail: { url, leaf: options.leaf ?? "tab", active: options.active ?? true },
    cancelable: true,
  });
  win.dispatchEvent(event);
  if (!event.defaultPrevented) win.open(url, "_blank");
}

/**
 * One delegated listener per document instead of a binding per anchor: every
 * `http(s)` link in the app — rendered markdown, settings, the community
 * browsers, plugin UIs — is routed through {@link openExternalUrl}, so no
 * `target="_blank"` reaches Chromium's own window-open path.
 */
export function installExternalLinkHandler(doc: Document): () => void {
  const onAuxClick = (event: MouseEvent): void => {
    if (event.defaultPrevented || (event.button !== 0 && event.button !== 1)) return;
    const target = event.target instanceof Element ? event.target : null;
    const linkEl = target?.closest<HTMLAnchorElement>("a[href]");
    const href = linkEl?.getAttribute("href") ?? "";
    if (!href || !/^https?:/i.test(href)) return;
    event.preventDefault();
    openExternalUrl(href, {
      leaf: event.button === 1 || event.metaKey || event.ctrlKey ? "split" : "tab",
      win: doc.defaultView ?? window,
    });
  };
  doc.addEventListener("click", onAuxClick);
  doc.addEventListener("auxclick", onAuxClick);
  return () => {
    doc.removeEventListener("click", onAuxClick);
    doc.removeEventListener("auxclick", onAuxClick);
  };
}
