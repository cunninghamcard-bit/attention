export interface ObsidianBodyConfigSource {
  vault: {
    getConfig<T = unknown>(key: string): T | undefined;
  };
}

const LOCAL_POPOUT_BODY_CLASSES = [
  "is-frameless",
  "is-focused",
  "is-fullscreen",
  "is-hidden-frameless",
  "is-maximized",
  "is-popout-window",
];

const LOCAL_POPOUT_BODY_STYLE_PROPS = [
  "--zoom-factor",
  "--keyboard-height",
];

export function applyObsidianBodyClasses(body: HTMLElement, win: Window = body.ownerDocument.defaultView ?? window): void {
  body.classList.add("obsidian-app");
  body.classList.remove("mod-macos", "mod-windows", "mod-linux");
  const platformClass = getObsidianPlatformClass(win);
  body.classList.add(platformClass);
  // Obsidian styles its own scrollbars everywhere except macOS, which keeps the
  // native overlay scrollbars: `Yl.isMacOS || document.body.addClass("styled-scrollbars")`.
  body.classList.toggle("styled-scrollbars", platformClass !== "mod-macos");
}

export function syncObsidianConfigBodyClasses(body: HTMLElement, app: ObsidianBodyConfigSource): void {
  body.classList.toggle("show-view-header", app.vault.getConfig<boolean>("showViewHeader") !== false);
  body.classList.toggle("show-ribbon", app.vault.getConfig<boolean>("showRibbon") !== false);
}

export function syncBodyThemeClasses(target: HTMLElement, source: HTMLElement = document.body): void {
  target.classList.toggle("theme-dark", source.classList.contains("theme-dark"));
  target.classList.toggle("theme-light", source.classList.contains("theme-light"));
}

export function installPopoutBodyClassSync(sourceBody: HTMLElement, targetBody: HTMLElement): () => void {
  if (sourceBody === targetBody) return () => {};
  const sync = () => syncPopoutBodyFromMain(sourceBody, targetBody);
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(sourceBody, { attributes: true, attributeFilter: ["class", "style"] });
  return () => observer.disconnect();
}

export function syncPopoutBodyFromMain(sourceBody: HTMLElement, targetBody: HTMLElement): void {
  const localClasses = new Map(LOCAL_POPOUT_BODY_CLASSES.map((className) => [className, targetBody.classList.contains(className)]));
  const localStyles = new Map(LOCAL_POPOUT_BODY_STYLE_PROPS.map((prop) => [prop, targetBody.style.getPropertyValue(prop)]));

  targetBody.className = sourceBody.className;
  for (const [className, enabled] of localClasses) targetBody.classList.toggle(className, enabled);
  targetBody.classList.add("is-popout-window");

  targetBody.style.cssText = sourceBody.style.cssText;
  for (const [prop, value] of localStyles) {
    if (value) targetBody.style.setProperty(prop, value);
    else targetBody.style.removeProperty(prop);
  }
}

export function installFocusBodyClassSync(win: Window = window): () => void {
  const update = () => syncFocusBodyClass(win);
  update();
  win.addEventListener("focus", update);
  win.addEventListener("blur", update);
  win.addEventListener("focuschange", update);
  return () => {
    win.removeEventListener("focus", update);
    win.removeEventListener("blur", update);
    win.removeEventListener("focuschange", update);
  };
}

export function syncFocusBodyClass(win: Window = window): void {
  const electronWindow = (win as Window & { electronWindow?: { isFocused?: () => boolean } }).electronWindow;
  const focused = electronWindow?.isFocused?.() ?? win.document.hasFocus?.() ?? true;
  win.document.body.classList.toggle("is-focused", focused);
}

export function getObsidianPlatformClass(win: Window = window): "mod-macos" | "mod-windows" | "mod-linux" {
  const platform = win.navigator.platform;
  const userAgent = win.navigator.userAgent;
  if (/Mac|iPhone|iPad|iPod/.test(platform)) return "mod-macos";
  if (/Win/.test(platform)) return "mod-windows";
  if (/Linux|X11/.test(platform) || /Linux/.test(userAgent)) return "mod-linux";
  return "mod-macos";
}
