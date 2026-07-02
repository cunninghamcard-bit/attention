import { Component } from "../core/Component";
import { getActiveDocument } from "../dom/ActiveDocument";
import { Platform } from "../platform/Platform";
import { setIcon as renderIcon } from "./Icon";
import type { HistoryHandler } from "./Modal";
import { setTooltip as setElementTooltip } from "./Popover";
import { registerActiveCloseable, unregisterActiveCloseable } from "./ActiveCloseableRegistry";

export interface MenuPositionDef {
  x: number;
  y: number;
  width?: number;
  overlap?: boolean;
  left?: boolean;
}

export interface MenuPosition extends MenuPositionDef {}

export interface MenuSectionSubmenuConfig {
  title: string;
  icon?: string;
  disabled?: boolean;
}

const eventMenus = new WeakMap<Event, Menu>();
const openTopMenus = new WeakMap<Document, Set<Menu>>();

export class MenuItem {
  readonly dom: HTMLElement;
  readonly iconEl: HTMLElement;
  readonly titleEl: HTMLElement;
  readonly menu: Menu;
  section = "";
  checked: boolean | null = null;
  disabled = false;
  submenu: Menu | null = null;
  private callback: ((event: MouseEvent | KeyboardEvent) => void) | null = null;
  private checkIconEl: HTMLElement | null = null;
  private submenuIconEl: HTMLElement | null = null;

  constructor(menu: Menu) {
    this.menu = menu;
    const doc = menu.doc;
    this.dom = doc.createElement("div");
    this.iconEl = doc.createElement("div");
    this.titleEl = doc.createElement("div");
    this.dom.className = "menu-item tappable";
    this.iconEl.className = "menu-item-icon";
    this.titleEl.className = "menu-item-title";
    this.dom.append(this.iconEl, this.titleEl);
    this.dom.addEventListener("click", (event) => this.handleEvent(event));
    this.dom.addEventListener("mouseenter", () => this.menu.selectElement(this.dom, false));
  }

  setTitle(title: string | DocumentFragment): this;
  setTitle(title: string | Node): this;
  setTitle(title: string | Node): this {
    this.titleEl.replaceChildren();
    if (typeof title === "string") this.titleEl.textContent = title;
    else this.titleEl.appendChild(title);
    return this;
  }

  setIcon(icon: string | null): this {
    this.iconEl.replaceChildren();
    if (icon) renderIcon(this.iconEl, icon);
    else delete this.iconEl.dataset.icon;
    return this;
  }

  removeIcon(): this {
    this.iconEl.remove();
    delete this.dom.dataset.icon;
    return this;
  }

  setActive(active: boolean): this {
    return this.setChecked(active);
  }

  setChecked(checked: boolean | null): this {
    this.checked = checked;
    this.dom.classList.toggle("mod-checked", Boolean(checked));
    if (checked && !this.checkIconEl) {
      this.checkIconEl = this.dom.ownerDocument.createElement("div");
      this.checkIconEl.className = "menu-item-icon mod-checked";
      renderIcon(this.checkIconEl, "lucide-check");
      this.dom.appendChild(this.checkIconEl);
    } else if (!checked) {
      this.checkIconEl?.remove();
      this.checkIconEl = null;
    }
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    this.dom.classList.toggle("is-disabled", disabled);
    return this;
  }

  setWarning(isWarning: boolean): this {
    this.dom.classList.toggle("is-warning", isWarning);
    return this;
  }

  setIsLabel(isLabel: boolean): this {
    this.dom.classList.toggle("tappable", !isLabel);
    this.dom.classList.toggle("is-label", isLabel);
    return this;
  }

  setSection(section: string): this {
    this.section = section;
    this.dom.dataset.section = section;
    return this;
  }

  setTooltip(tooltip: string): this {
    setElementTooltip(this.dom, tooltip);
    return this;
  }

  setSubmenu(): Menu {
    if (!this.submenu) {
      this.submenu = new Menu(this.menu.doc);
      this.dom.classList.add("has-submenu");
      this.submenuIconEl = this.dom.ownerDocument.createElement("div");
      this.submenuIconEl.className = "menu-item-icon mod-submenu";
      renderIcon(this.submenuIconEl, "lucide-chevron-right");
      this.dom.appendChild(this.submenuIconEl);
    }
    return this.submenu;
  }

  onClick(handler: (event: MouseEvent | KeyboardEvent) => any): this {
    this.callback = handler;
    return this;
  }

  handleEvent(event: MouseEvent | KeyboardEvent): void {
    if (this.disabled) {
      event.preventDefault();
      return;
    }
    if (this.submenu) {
      event.preventDefault();
      this.menu.openSubmenu(this);
      return;
    }
    this.callback?.(event);
    this.menu.hide();
  }
}

export class MenuSeparator {
  readonly dom: HTMLElement;

  constructor(readonly menu: Menu) {
    this.dom = menu.doc.createElement("div");
    this.dom.className = "menu-separator";
  }
}

export class Menu extends Component implements HistoryHandler {
  static useNativeMenu = false;

  readonly dom: HTMLElement;
  readonly doc: Document;
  readonly grabberEl: HTMLElement;
  readonly scrollEl: HTMLElement;
  readonly bgEl: HTMLElement;
  items: Array<MenuItem | MenuSeparator> = [];
  sections: string[] = [];
  submenuConfigs: Record<string, MenuSectionSubmenuConfig> = {};
  parentMenu: Menu | null = null;
  currentSubmenu: Menu | null = null;
  selected = -1;
  useNativeMenu = Menu.useNativeMenu;
  showMacWritingTools = false;
  private parentEl: Element | null = null;
  private hideCallback: (() => void) | null = null;
  private shown = false;
  private hiding = false;
  private outsideCleanup: (() => void) | null = null;
  private parentElementCleanup: (() => void) | null = null;
  private submenuOpenTimer: ReturnType<typeof setTimeout> | null = null;
  private shownDoc: Document | null = null;

  constructor(doc: Document = getActiveDocument()) {
    super();
    this.doc = doc;
    this.dom = doc.createElement("div");
    this.dom.className = "menu";
    this.grabberEl = doc.createElement("div");
    this.grabberEl.className = "menu-grabber";
    this.scrollEl = doc.createElement("div");
    this.scrollEl.className = "menu-scroll";
    this.bgEl = doc.createElement("div");
    this.bgEl.className = "suggestion-bg";
    this.bgEl.style.opacity = "0";
    this.dom.append(this.grabberEl, this.scrollEl);
    this.bgEl.addEventListener("mousedown", (event) => event.preventDefault());
    this.bgEl.addEventListener("click", () => this.hide());
    this.dom.addEventListener("mousedown", (event) => {
      if (event.button === 0) event.preventDefault();
    });
    this.dom.addEventListener("mouseover", (event) => {
      const target = event.target;
      if (target instanceof Node) this.selectElement(target, false);
    });
  }

  addSections(sections: string[]): this {
    const incoming = sections.filter((section) => !this.sections.includes(section));
    const emptyIndex = this.sections.indexOf("");
    const insertAt = emptyIndex === -1 ? this.sections.length : emptyIndex;
    this.sections.splice(insertAt, 0, ...incoming);
    return this;
  }

  setSectionSubmenu(section: string, config: MenuSectionSubmenuConfig): this {
    this.submenuConfigs[section] = config;
    return this;
  }

  addItem(callback: (item: MenuItem) => void): this {
    if (this._loaded) return this;
    const item = new MenuItem(this);
    this.items.push(item);
    callback(item);
    return this;
  }

  addSeparator(): this {
    if (this._loaded) return this;
    this.items.push(new MenuSeparator(this));
    return this;
  }

  setNoIcon(): this {
    this.dom.classList.add("mod-no-icon");
    return this;
  }

  setUseNativeMenu(useNativeMenu: boolean): this {
    this.useNativeMenu = useNativeMenu;
    return this;
  }

  setShowMacWritingTools(showMacWritingTools: boolean): this {
    this.showMacWritingTools = showMacWritingTools;
    return this;
  }

  setParentElement(el: Element): this {
    this.parentEl?.classList.remove("has-active-menu");
    this.parentEl = el;
    return this;
  }

  showAtMouseEvent(event: (MouseEvent | PointerEvent) & { doc?: Document }): this {
    return this.showAtPosition({ x: event.clientX, y: event.clientY }, event.doc ?? eventDocument(event));
  }

  showAtPosition(position: MenuPosition, doc: Document = this.doc): this {
    if (!this.parentMenu) hideOtherTopMenus(doc, this);
    this.unloadForShow();
    if (this.items.length === 0) return this;

    this.sort();
    this.shown = true;
    this.hiding = false;
    this.shownDoc = doc;
    this.dom.style.position = "fixed";
    this.dom.classList.toggle("mod-native-menu", this.useNativeMenu);
    this.parentEl?.classList.add("has-active-menu");
    this.watchParentElement();

    if (Platform.isDesktop && this.useNativeMenu && this.showNativeMenu(position, doc)) return this;

    if (!this.parentMenu) getOpenTopMenus(doc).add(this);
    if (this.dom.parentElement !== doc.body) doc.body.appendChild(this.dom);
    if (this.bgEl.parentElement !== doc.body) doc.body.appendChild(this.bgEl);
    registerActiveCloseable(this);
    this.positionDom(position, doc);
    this.registerOutsideHandlers(doc);
    (doc.defaultView ?? window).setTimeout(() => void this.load());
    return this;
  }

  hide(): this {
    if (this.hiding) return this;
    this.hiding = true;
    this.unload();
    this.outsideCleanup?.();
    this.outsideCleanup = null;
    this.parentElementCleanup?.();
    this.parentElementCleanup = null;
    this.unselect();
    this.closeSubmenu();
    this.dom.remove();
    this.bgEl.remove();
    unregisterActiveCloseable(this);
    if (!this.parentMenu) getOpenTopMenus(this.shownDoc ?? this.doc).delete(this);
    this.shownDoc = null;
    this.parentEl?.classList.remove("has-active-menu");
    this.parentEl = null;
    if (this.parentMenu?.currentSubmenu === this) this.parentMenu.currentSubmenu = null;
    this.parentMenu = null;
    const callback = this.hideCallback;
    this.hideCallback = null;
    this.shown = false;
    this.hiding = false;
    callback?.();
    return this;
  }

  close(): void {
    this.hide();
  }

  onHide(handler: () => any): void {
    this.hideCallback = handler;
  }

  onHistoryBack(): void {
    this.hide();
  }

  sort(): void {
    const buckets: Record<string, Array<MenuItem | MenuSeparator>> = { "": [] };
    const sections = [...this.sections];
    for (const item of this.items) {
      const section = item instanceof MenuItem ? item.section : "";
      if (section && !sections.includes(section)) sections.push(section);
      (buckets[section] ??= []).push(item);
    }

    const ordered: Array<MenuItem | MenuSeparator> = [];
    const renderedSubmenus = new Map<string, MenuItem>();
    let previousTopSection: string | null = null;

    for (const section of sections) {
      const bucket = buckets[section];
      if (!bucket || bucket.length === 0) continue;
      const submenuPrefix = this.findSubmenuPrefix(section);
      if (submenuPrefix) {
        const submenuItem = renderedSubmenus.get(submenuPrefix) ?? this.createSectionSubmenuItem(submenuPrefix, ordered, renderedSubmenus);
        if (submenuItem.submenu) {
          if (submenuItem.submenu.items.length > 0) submenuItem.submenu.items.push(new MenuSeparator(submenuItem.submenu));
          for (const item of bucket) {
            if (item instanceof MenuItem) item.setSection(trimSubmenuSection(item.section, submenuPrefix));
            submenuItem.submenu.items.push(item);
          }
        }
        previousTopSection = topSection(section);
        continue;
      }

      const nextTopSection = topSection(section);
      if (previousTopSection !== null && previousTopSection !== nextTopSection) ordered.push(new MenuSeparator(this));
      ordered.push(...bucket);
      previousTopSection = nextTopSection;
    }

    if (!sections.includes("") && buckets[""].length > 0) {
      if (ordered.length > 0) ordered.push(new MenuSeparator(this));
      ordered.push(...buckets[""]);
    }
    this.items = trimSeparators(ordered);
    for (const item of this.items) {
      if (item instanceof MenuItem && item.submenu) item.submenu.sort();
    }
    this.renderSorted();
  }

  selectElement(el: Node, openSubmenu: boolean): void {
    for (let index = 0; index < this.items.length; index += 1) {
      const item = this.items[index];
      if (item.dom.contains(el)) {
        if (item instanceof MenuItem) {
          this.select(index);
          if (openSubmenu) this.openSubmenu(item);
          else if (item.submenu) this.openSubmenuSoon(item);
          else this.closeSubmenu();
        }
        return;
      }
    }
  }

  select(index: number): void {
    if (this.items.length === 0) return;
    const current = this.selected < 0 ? null : this.items[this.selected];
    current?.dom.classList.remove("selected");
    this.selected = normalizeIndex(index, this.items.length);
    const next = this.items[this.selected];
    next.dom.classList.add("selected");
    next.dom.scrollIntoView?.({ block: "nearest" });
  }

  unselect(): void {
    const current = this.selected < 0 ? null : this.items[this.selected];
    current?.dom.classList.remove("selected");
    this.selected = -1;
    this.closeSubmenu();
  }

  openSubmenu(item: MenuItem): void {
    if (item.disabled || !item.submenu) return;
    if (this.currentSubmenu === item.submenu) return;
    this.clearSubmenuOpenTimer();
    this.closeSubmenu();
    this.currentSubmenu = item.submenu;
    item.submenu.parentMenu = this;
    const rect = item.dom.getBoundingClientRect();
    item.submenu.showAtPosition({ x: rect.left, y: rect.top, width: rect.width }, item.dom.ownerDocument);
  }

  closeSubmenu(): void {
    this.clearSubmenuOpenTimer();
    const submenu = this.currentSubmenu;
    if (!submenu) return;
    this.currentSubmenu = null;
    submenu.hide();
  }

  static forEvent(event: PointerEvent | MouseEvent): Menu {
    event.preventDefault();
    let menu = eventMenus.get(event);
    if (!menu) {
      menu = new Menu(eventDocument(event));
      eventMenus.set(event, menu);
      const win = eventDocument(event).defaultView ?? window;
      win.setTimeout(() => menu?.showAtMouseEvent(event));
    }
    return menu;
  }

  private showNativeMenu(position: MenuPosition, doc: Document): boolean {
    const win = doc.defaultView ?? window;
    const bridge = getElectronBridge(win);
    const remote = bridge?.remote;
    const buildFromTemplate = remote?.Menu?.buildFromTemplate;
    if (!buildFromTemplate || !remote.getCurrentWebContents || !remote.getCurrentWindow) return false;

    const nativeMenu = buildFromTemplate(toNativeMenuTemplate(this.items));
    nativeMenu.on?.("menu-will-close", () => this.hide());
    const webContents = remote.getCurrentWebContents();
    const zoom = Math.pow(1.2, webContents.getZoomLevel());
    nativeMenu.popup({
      x: Math.round(position.x * zoom),
      y: Math.round(position.y * zoom),
      window: remote.getCurrentWindow(),
      frame: this.showMacWritingTools ? webContents.focusedFrame : undefined,
    });
    return true;
  }

  private renderSorted(): void {
    this.scrollEl.replaceChildren();
    let groupEl: HTMLElement | null = null;
    for (const item of this.items) {
      if (item instanceof MenuSeparator) {
        groupEl = null;
        this.scrollEl.appendChild(item.dom);
      } else {
        groupEl ??= this.scrollEl.ownerDocument.createElement("div");
        groupEl.className = "menu-group";
        if (!groupEl.parentElement) this.scrollEl.appendChild(groupEl);
        groupEl.appendChild(item.dom);
      }
    }
  }

  private openSubmenuSoon(item: MenuItem): void {
    if (item.disabled || !item.submenu || this.currentSubmenu === item.submenu) return;
    this.clearSubmenuOpenTimer();
    const win = item.dom.ownerDocument.defaultView ?? window;
    this.submenuOpenTimer = win.setTimeout(() => {
      this.submenuOpenTimer = null;
      this.openSubmenu(item);
    }, 250);
  }

  private clearSubmenuOpenTimer(): void {
    if (!this.submenuOpenTimer) return;
    (this.doc.defaultView ?? window).clearTimeout(this.submenuOpenTimer);
    this.submenuOpenTimer = null;
  }

  private watchParentElement(): void {
    this.parentElementCleanup?.();
    this.parentElementCleanup = null;
    const parentEl = this.parentEl;
    if (!parentEl) return;
    const win = parentEl.ownerDocument.defaultView ?? window;
    const interval = win.setInterval(() => {
      if (!isMenuParentShown(parentEl)) this.hide();
    }, 500);
    this.parentElementCleanup = () => win.clearInterval(interval);
  }

  private createSectionSubmenuItem(prefix: string, ordered: Array<MenuItem | MenuSeparator>, rendered: Map<string, MenuItem>): MenuItem {
    const item = new MenuItem(this);
    const config = this.submenuConfigs[prefix];
    item.setTitle(config.title);
    if (config.icon) item.setIcon(config.icon);
    if (config.disabled) item.setDisabled(true);
    item.setSubmenu();
    ordered.push(item);
    rendered.set(prefix, item);
    return item;
  }

  private findSubmenuPrefix(section: string): string | null {
    for (const prefix of Object.keys(this.submenuConfigs)) {
      if (section === prefix || section.startsWith(`${prefix}.`)) return prefix;
    }
    return null;
  }

  private positionDom(position: MenuPosition, doc: Document): void {
    const win = doc.defaultView ?? window;
    const width = this.dom.offsetWidth || 220;
    const height = this.dom.offsetHeight || 1;
    let left = position.x + 2;
    let right = position.x - 2;
    if (position.width !== undefined) {
      if (position.overlap) {
        left = position.x;
        right = position.x + position.width;
      } else {
        left = position.x + position.width;
        right = position.x;
      }
    }
    const shouldOpenLeft = position.left === true || (left + width > win.innerWidth && right - width >= 0);
    const top = position.y + height > win.innerHeight ? Math.max(0, position.y - height) : position.y + 2;
    this.dom.style.left = shouldOpenLeft ? `${Math.max(0, right - width)}px` : `${left}px`;
    this.dom.style.top = `${top}px`;
  }

  private registerOutsideHandlers(doc: Document): void {
    this.outsideCleanup?.();
    const win = doc.defaultView ?? window;
    const onPointer = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && this.isInside(target)) return;
      this.hide();
    };
    const onKeyDown = (event: KeyboardEvent) => this.handleKeydown(event);
    win.addEventListener("keydown", onKeyDown);
    const pointerTimer = win.setTimeout(() => {
      if (typeof win.addEventListener !== "function") return;
      win.addEventListener("mousedown", onPointer);
      win.addEventListener("click", onPointer);
      win.addEventListener("contextmenu", onPointer);
    });
    this.outsideCleanup = () => {
      win.clearTimeout(pointerTimer);
      win.removeEventListener("mousedown", onPointer);
      win.removeEventListener("click", onPointer);
      win.removeEventListener("contextmenu", onPointer);
      win.removeEventListener("keydown", onKeyDown);
    };
  }

  private unloadForShow(): void {
    this.unload();
    this.outsideCleanup?.();
    this.outsideCleanup = null;
    this.unselect();
    this.closeSubmenu();
    this.dom.remove();
    this.bgEl.remove();
    if (!this.parentMenu) getOpenTopMenus(this.shownDoc ?? this.doc).delete(this);
    this.shownDoc = null;
    this.shown = false;
    this.hiding = false;
  }

  private isInside(node: Node): boolean {
    if (this.dom.contains(node)) return true;
    for (let menu = this.parentMenu; menu; menu = menu.parentMenu) {
      if (menu.dom.contains(node)) return true;
    }
    for (let menu = this.currentSubmenu; menu; menu = menu.currentSubmenu) {
      if (menu.dom.contains(node)) return true;
    }
    return false;
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      this.selectRelative(-1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      this.selectRelative(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (this.parentMenu) this.hide();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      const item = this.selected < 0 ? null : this.items[this.selected];
      if (item instanceof MenuItem) {
        this.openSubmenu(item);
        this.currentSubmenu?.select(0);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = this.selected < 0 ? null : this.items[this.selected];
      if (item instanceof MenuItem) {
        item.handleEvent(event);
        this.hide();
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      this.hide();
    }
  }

  private selectRelative(delta: number): void {
    if (this.items.length === 0) return;
    let index = this.selected < 0 ? (delta > 0 ? 0 : this.items.length - 1) : this.selected + delta;
    for (let count = 0; count < this.items.length; count += 1) {
      index = normalizeIndex(index, this.items.length);
      const item = this.items[index];
      if (item instanceof MenuItem && !item.disabled) {
        this.select(index);
        return;
      }
      index += delta;
    }
  }
}

interface NativeMenuTemplateItem {
  label?: string;
  enabled?: boolean;
  checked?: boolean | null;
  type?: "checkbox" | "separator";
  submenu?: NativeMenuTemplateItem[];
  click?: (_item?: unknown, _window?: unknown, event?: MouseEventInit) => void;
}

interface NativeMenu {
  on?: (name: "menu-will-close", callback: () => void) => void;
  popup: (options: { x: number; y: number; window: unknown; frame?: unknown }) => void;
}

interface MenuElectronBridge {
  remote?: {
    Menu?: {
      buildFromTemplate?: (template: NativeMenuTemplateItem[]) => NativeMenu;
    };
    getCurrentWebContents?: () => { getZoomLevel: () => number; focusedFrame?: unknown };
    getCurrentWindow?: () => unknown;
  };
}

function getElectronBridge(win: Window & { electron?: MenuElectronBridge }): MenuElectronBridge | null {
  const host = globalThis as { electron?: MenuElectronBridge };
  return win.electron ?? host.electron ?? null;
}

function toNativeMenuTemplate(items: Array<MenuItem | MenuSeparator>): NativeMenuTemplateItem[] {
  return items.map((item) => {
    if (item instanceof MenuSeparator) return { type: "separator" };
    const template: NativeMenuTemplateItem = {
      label: (item.titleEl.textContent ?? "").replace(/\B&\B/, "&&"),
      enabled: !item.disabled && !item.dom.classList.contains("is-label"),
      checked: item.checked,
      type: typeof item.checked === "boolean" ? "checkbox" : undefined,
      click: (_item, _window, event) => item.handleEvent(new MouseEvent("click", event)),
    };
    if (item.submenu) {
      item.submenu.sort();
      template.submenu = toNativeMenuTemplate(item.submenu.items);
    }
    return template;
  });
}

function eventDocument(event: Event): Document {
  const target = event.target as Node | null;
  return target?.ownerDocument ?? getActiveDocument();
}

function isMenuParentShown(el: Element): boolean {
  if (!el.ownerDocument.body.contains(el)) return false;
  if ("hidden" in el && (el as HTMLElement).hidden) return false;
  const maybeShown = el as Element & { isShown?: () => boolean };
  return typeof maybeShown.isShown === "function" ? maybeShown.isShown() : true;
}

function getOpenTopMenus(doc: Document): Set<Menu> {
  let menus = openTopMenus.get(doc);
  if (!menus) {
    menus = new Set();
    openTopMenus.set(doc, menus);
  }
  return menus;
}

/** Real `jg()`: close every open top-level menu in a document (used when a modal opens). */
export function closeAllMenus(doc: Document): void {
  for (const menu of [...getOpenTopMenus(doc)]) menu.hide();
}

function hideOtherTopMenus(doc: Document, except: Menu): void {
  for (const menu of [...getOpenTopMenus(doc)]) {
    if (menu !== except) menu.hide();
  }
}

function trimSubmenuSection(section: string, prefix: string): string {
  if (section === prefix) return "";
  return section.slice(prefix.length + 1);
}

function topSection(section: string): string {
  return section.split(".")[0] ?? section;
}

function trimSeparators(items: Array<MenuItem | MenuSeparator>): Array<MenuItem | MenuSeparator> {
  const next = [...items];
  while (next[0] instanceof MenuSeparator) next.shift();
  while (next[next.length - 1] instanceof MenuSeparator) next.pop();
  return next.filter((item, index) => !(item instanceof MenuSeparator && next[index - 1] instanceof MenuSeparator));
}

function normalizeIndex(index: number, length: number): number {
  return ((index % length) + length) % length;
}
