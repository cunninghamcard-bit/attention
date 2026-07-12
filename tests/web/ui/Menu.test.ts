import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeTopActiveCloseable, getActiveCloseables, registerActiveCloseable, unregisterActiveCloseable } from "@web/ui/ActiveCloseableRegistry";
import { Menu, MenuItem } from "@web/ui/Menu";

let dom: JSDOM | null = null;

beforeEach(() => {
  dom = new JSDOM("<!doctype html><html><body><button id=\"anchor\"></button></body></html>", { pretendToBeVisual: true });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("MouseEvent", dom.window.MouseEvent);
  vi.stubGlobal("KeyboardEvent", dom.window.KeyboardEvent);
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  while (closeTopActiveCloseable()) {
    // Drain Obsidian's active closeable stack between isolated DOM tests.
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
  dom?.window.close();
  dom = null;
});

function titles(menu: Menu): string[] {
  return [...menu.dom.querySelectorAll<HTMLElement>(".menu-item-title")].map((el) => el.textContent ?? "");
}

describe("Menu Obsidian behavior", () => {
  it("constructs Obsidian's menu shell and renders items only when shown", () => {
    const menu = new Menu(document);

    expect([...menu.dom.children].map((child) => child.className)).toEqual(["menu-grabber", "menu-scroll"]);
    expect(menu.dom.getAttribute("role")).toBeNull();
    expect(menu.selected).toBe(-1);
    expect(menu.useNativeMenu).toBe(Menu.useNativeMenu);
    expect(menu.grabberEl.parentElement).toBe(menu.dom);
    expect(menu.scrollEl.parentElement).toBe(menu.dom);
    expect(menu.bgEl.className).toBe("suggestion-bg");
    expect(menu.bgEl.style.opacity).toBe("0");

    menu.addItem((item) => item.setTitle("Open").setIcon("lucide-file"));

    expect(menu.scrollEl.querySelector(".menu-item")).toBeNull();

    menu.showAtPosition({ x: 10, y: 20 });
    const itemEl = menu.dom.querySelector<HTMLElement>(".menu-item");

    expect(menu.dom.parentElement).toBe(document.body);
    expect(menu.bgEl.parentElement).toBe(document.body);
    expect(itemEl?.querySelector(".menu-item-accelerator")).toBeNull();
  });

  it("inherits static native menu default for new menu instances", () => {
    const previous = Menu.useNativeMenu;
    try {
      Menu.useNativeMenu = true;
      const menu = new Menu(document);

      expect(menu.useNativeMenu).toBe(true);

      menu.addItem((item) => item.setTitle("Native"));
      menu.showAtPosition({ x: 10, y: 20 });

      expect(menu.dom.classList.contains("mod-native-menu")).toBe(true);
    } finally {
      Menu.useNativeMenu = previous;
    }
  });

  it("uses Electron native menus without mounting DOM when a native bridge is available", () => {
    const parent = document.querySelector<HTMLElement>("#anchor");
    if (!parent) throw new Error("missing parent");
    const popup = vi.fn();
    const currentWindow = {};
    const closeHandlers: Array<() => void> = [];
    let template: unknown[] = [];
    const buildFromTemplate = vi.fn((items: unknown[]) => {
      template = items;
      return {
        on: vi.fn((_name: "menu-will-close", callback: () => void) => closeHandlers.push(callback)),
        popup,
      };
    });
    (window as Window & { electron?: unknown }).electron = {
      remote: {
        Menu: { buildFromTemplate },
        getCurrentWebContents: () => ({ getZoomLevel: () => 0, focusedFrame: "frame" }),
        getCurrentWindow: () => currentWindow,
      },
    };
    const onClick = vi.fn();
    const menu = new Menu(document);
    menu.setParentElement(parent).setUseNativeMenu(true).setShowMacWritingTools(true);
    menu.addItem((item) => item.setTitle("Checked").setChecked(true).onClick(onClick));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Disabled").setDisabled(true));
    menu.addItem((item) => {
      item.setTitle("More");
      item.setSubmenu().addItem((child) => child.setTitle("Child"));
    });

    menu.showAtPosition({ x: 10, y: 20 });

    expect(buildFromTemplate).toHaveBeenCalledOnce();
    expect(template).toMatchObject([
      { label: "Checked", enabled: true, checked: true, type: "checkbox" },
      { type: "separator" },
      { label: "Disabled", enabled: false },
      { label: "More", submenu: [{ label: "Child" }] },
    ]);
    expect(popup).toHaveBeenCalledWith({ x: 10, y: 20, window: currentWindow, frame: "frame" });
    expect(menu.dom.parentElement).toBeNull();
    expect(menu.bgEl.parentElement).toBeNull();
    expect(parent.classList.contains("has-active-menu")).toBe(true);

    closeHandlers[0]?.();

    expect(parent.classList.contains("has-active-menu")).toBe(false);
  });

  it("sorts explicit sections before the default section and inserts separators", () => {
    const menu = new Menu(document);
    menu.addSections(["navigation", "action", "danger"]);
    menu.addItem((item) => item.setTitle("Delete").setSection("danger"));
    menu.addItem((item) => item.setTitle("Open").setSection("navigation"));
    menu.addItem((item) => item.setTitle("Copy").setSection("action"));
    menu.addItem((item) => item.setTitle("Default"));

    menu.showAtPosition({ x: 10, y: 20 });

    expect(titles(menu)).toEqual(["Open", "Copy", "Delete", "Default"]);
    expect(menu.dom.querySelectorAll(".menu-separator")).toHaveLength(3);
  });

  it("uses event.doc when showing a menu from a popout document event", () => {
    const popout = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
    try {
      const menu = new Menu(document);
      const event = new MouseEvent("contextmenu", { clientX: 30, clientY: 40 });
      Object.defineProperty(event, "doc", { value: popout.window.document });
      menu.addItem((item) => item.setTitle("Popout"));

      menu.showAtMouseEvent(event);

      expect(menu.dom.parentElement).toBe(popout.window.document.body);
      expect(menu.bgEl.parentElement).toBe(popout.window.document.body);
    } finally {
      popout.window.close();
    }
  });

  it("moves configured section prefixes into a submenu", () => {
    const menu = new Menu(document);
    menu
      .addSections(["action.copy", "action.paste", "danger"])
      .setSectionSubmenu("action", { title: "Actions", icon: "lucide-copy" });
    menu.addItem((item) => item.setTitle("Paste").setSection("action.paste"));
    menu.addItem((item) => item.setTitle("Delete").setSection("danger"));
    menu.addItem((item) => item.setTitle("Copy").setSection("action.copy"));

    menu.showAtPosition({ x: 10, y: 20 });

    expect(titles(menu)).toEqual(["Actions", "Delete"]);
    expect(menu.dom.querySelector(".menu-item-icon svg.lucide-copy")).not.toBeNull();
    const submenuItem = menu.items.find((item): item is MenuItem => item instanceof MenuItem && !!item.submenu);
    const submenu = submenuItem?.submenu;
    expect(submenu && titles(submenu)).toEqual(["Copy", "Paste"]);
    expect(submenu?.parentMenu).toBeNull();

    if (!submenuItem) throw new Error("missing submenu item");
    menu.openSubmenu(submenuItem);

    expect(submenu?.parentMenu).toBe(menu);
  });

  it("delays submenu opening on hover like Obsidian", () => {
    vi.useFakeTimers();
    const menu = new Menu(document);
    menu
      .addSections(["info.copy"])
      .setSectionSubmenu("info", { title: "Info", icon: "lucide-info" });
    menu.addItem((item) => item.setTitle("Copy path").setSection("info.copy"));
    menu.showAtPosition({ x: 10, y: 20 });
    const submenuItem = menu.items.find((item): item is MenuItem => item instanceof MenuItem && !!item.submenu);
    if (!submenuItem) throw new Error("missing submenu item");

    submenuItem.dom.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    vi.advanceTimersByTime(249);

    expect(menu.currentSubmenu).toBeNull();

    vi.advanceTimersByTime(1);

    expect(menu.currentSubmenu).toBe(submenuItem.submenu);
    expect(submenuItem.submenu?.parentMenu).toBe(menu);
  });

  it("treats checked state as a separate check icon and supports active alias", () => {
    const menu = new Menu(document);
    menu.addItem((item) => item.setTitle("Pinned").setIcon("lucide-pin").setActive(true));
    menu.showAtPosition({ x: 10, y: 20 });

    const itemEl = menu.dom.querySelector<HTMLElement>(".menu-item");
    const iconEl = itemEl?.querySelector<HTMLElement>(".menu-item-icon:not(.mod-checked)");

    expect(iconEl?.querySelector("svg")?.classList.contains("lucide-pin")).toBe(true);
    expect(itemEl?.querySelector(".menu-item-icon.mod-checked")).not.toBeNull();
    expect(itemEl?.classList.contains("mod-checked")).toBe(true);
  });

  it("supports null checked state without rendering a checkbox", () => {
    const menu = new Menu(document);
    menu.addItem((item) => item.setTitle("Tri-state").setChecked(true).setChecked(null));
    menu.showAtPosition({ x: 10, y: 20 });

    const item = menu.items.find((candidate): candidate is MenuItem => candidate instanceof MenuItem);
    const itemEl = menu.dom.querySelector<HTMLElement>(".menu-item");

    expect(item?.checked).toBeNull();
    expect(itemEl?.classList.contains("mod-checked")).toBe(false);
    expect(itemEl?.querySelector(".menu-item-icon.mod-checked")).toBeNull();
  });

  it("does not mutate a menu after it has been shown", () => {
    const menu = new Menu(document);
    menu.addItem((item) => item.setTitle("Initial"));
    menu.showAtPosition({ x: 10, y: 20 });

    menu.addItem((item) => item.setTitle("Late"));
    menu.addSeparator();

    expect(titles(menu)).toEqual(["Initial"]);
    expect(menu.dom.querySelector(".menu-separator")).toBeNull();
  });

  it("fires onHide once and clears parent active state", async () => {
    const parent = document.querySelector<HTMLElement>("#anchor");
    if (!parent) throw new Error("missing parent");
    const onHide = vi.fn();
    const menu = new Menu(document);
    menu.addItem((item) => item.setTitle("Close"));
    expect(menu.onHide(onHide)).toBeUndefined();
    menu.setParentElement(parent).showAtPosition({ x: 10, y: 20 });
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(menu._loaded).toBe(true);
    expect(parent.classList.contains("has-active-menu")).toBe(true);
    expect(menu.dom.parentElement).toBe(document.body);
    expect(parent.querySelector(".menu")).toBeNull();

    menu.hide();
    menu.hide();

    expect(menu._loaded).toBe(false);
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(parent.classList.contains("has-active-menu")).toBe(false);
  });

  it("hides when its parent element leaves the document", () => {
    vi.useFakeTimers();
    const parent = document.querySelector<HTMLElement>("#anchor");
    if (!parent) throw new Error("missing parent");
    const onHide = vi.fn();
    const menu = new Menu(document);
    menu.addItem((item) => item.setTitle("Close"));
    menu.onHide(onHide);
    menu.setParentElement(parent).showAtPosition({ x: 10, y: 20 });

    parent.remove();
    vi.advanceTimersByTime(499);

    expect(menu.dom.isConnected).toBe(true);

    vi.advanceTimersByTime(1);

    expect(menu.dom.isConnected).toBe(false);
    expect(onHide).toHaveBeenCalledOnce();
  });

  it("skips disabled items during keyboard navigation and activates the selected item", () => {
    const onClick = vi.fn();
    const menu = new Menu(document);
    menu.addItem((item) => item.setTitle("Disabled").setDisabled(true));
    menu.addItem((item) => item.setTitle("Enabled").onClick(onClick));
    menu.showAtPosition({ x: 10, y: 20 });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(menu.dom.isConnected).toBe(false);
  });

  it("selects the first submenu item when opening a selected submenu with ArrowRight", () => {
    const menu = new Menu(document);
    let submenu: Menu | null = null;
    menu.addItem((item) => {
      item.setTitle("More");
      submenu = item.setSubmenu();
      submenu.addItem((child) => child.setTitle("Child"));
      submenu.addItem((child) => child.setTitle("Other"));
    });
    menu.showAtPosition({ x: 10, y: 20 });
    menu.select(0);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));

    expect(menu.currentSubmenu).toBe(submenu);
    expect(submenu?.selected).toBe(0);
    expect(submenu?.items[0]?.dom.classList.contains("selected")).toBe(true);
  });

  it("hides the menu after keyboard Enter triggers a selected submenu item", () => {
    const menu = new Menu(document);
    let submenu: Menu | null = null;
    menu.addItem((item) => {
      item.setTitle("More");
      submenu = item.setSubmenu();
      submenu.addItem((child) => child.setTitle("Child"));
    });
    menu.showAtPosition({ x: 10, y: 20 });
    menu.select(0);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(menu.dom.isConnected).toBe(false);
    expect(submenu?.dom.isConnected).toBe(false);
    expect(menu.currentSubmenu).toBeNull();
  });

  it("defers Menu.forEvent display so callers can add items before it opens", () => {
    vi.useFakeTimers();
    const anchor = document.querySelector<HTMLElement>("#anchor");
    if (!anchor) throw new Error("missing anchor");
    let menu: Menu | null = null;
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 40 });

    anchor.addEventListener("contextmenu", (evt) => {
      menu = Menu.forEvent(evt);
      menu.addItem((item) => item.setTitle("Deferred"));
      expect(Menu.forEvent(evt)).toBe(menu);
    });

    anchor.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(menu?.dom.parentElement).toBeNull();

    vi.runOnlyPendingTimers();

    expect(menu?.dom.parentElement).toBe(document.body);
    expect(titles(menu!)).toEqual(["Deferred"]);
  });

  it("closes through the HistoryHandler path and exposes official void close", () => {
    const menu = new Menu(document);
    menu.addItem((item) => item.setTitle("History"));
    menu.showAtPosition({ x: 10, y: 20 });

    expect(menu.close()).toBeUndefined();
    expect(menu.dom.parentElement).toBeNull();

    menu.showAtPosition({ x: 10, y: 20 });
    menu.onHistoryBack();

    expect(menu.dom.parentElement).toBeNull();
  });

  it("participates in Obsidian's LIFO active closeable stack", () => {
    const first = new Menu(document);
    const second = new Menu(document);
    first.addItem((item) => item.setTitle("First"));
    second.addItem((item) => item.setTitle("Second"));

    first.showAtPosition({ x: 10, y: 20 });
    second.showAtPosition({ x: 30, y: 40 });

    expect(getActiveCloseables()).toEqual([second]);

    const synthetic = { close: vi.fn(() => unregisterActiveCloseable(synthetic)) };
    registerActiveCloseable(first);
    registerActiveCloseable(synthetic);

    expect(getActiveCloseables()).toEqual([second, first, synthetic]);
    expect(closeTopActiveCloseable()).toBe(true);
    expect(synthetic.close).toHaveBeenCalledTimes(1);
    expect(getActiveCloseables()).toEqual([second, first]);

    unregisterActiveCloseable(second);
    expect(closeTopActiveCloseable()).toBe(true);

    expect(first.dom.isConnected).toBe(false);
    expect(getActiveCloseables()).toEqual([]);
  });

  it("hides only the owning submenu when a submenu item is clicked", () => {
    const onClick = vi.fn();
    const menu = new Menu(document);
    let submenu: Menu | null = null;
    menu.addItem((item) => {
      item.setTitle("More");
      submenu = item.setSubmenu();
      submenu.addItem((child) => child.setTitle("Child").onClick(onClick));
    });
    menu.showAtPosition({ x: 10, y: 20 });
    const parentItem = menu.items.find((item): item is MenuItem => item instanceof MenuItem && item.submenu !== null);
    if (!parentItem || !submenu) throw new Error("missing submenu");

    menu.openSubmenu(parentItem);
    const childItem = submenu.items.find((item): item is MenuItem => item instanceof MenuItem);
    if (!childItem) throw new Error("missing submenu child");

    childItem.handleEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(submenu.dom.isConnected).toBe(false);
    expect(menu.dom.isConnected).toBe(true);
    expect(menu.currentSubmenu).toBeNull();
  });
});
