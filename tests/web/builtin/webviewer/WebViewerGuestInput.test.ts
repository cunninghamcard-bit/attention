/**
 * Input: None
 * Output: test suite
 * Pos: Test code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import type { WebViewerView } from "@web/builtin/webviewer/WebViewerPlugin";

/**
 * A `<webview>` guest is its own webContents: nothing typed inside a page the
 * Web viewer shows reaches this document, so every app hotkey — Cmd+W is how
 * this surfaced — is dead while the guest holds focus. The view reaches the
 * guest through `@electron/remote` and replays its `before-input-event` into
 * the one keymap, the way the real webviewer's `configureWebContents` does.
 * The fake here stands in for that remote proxy.
 */

type GuestListener = (event: unknown, input: Record<string, unknown>) => void;

interface FakeGuest {
  emit: (event: string, input: Record<string, unknown>) => void;
  listenerCount: (event: string) => number;
  ignoreMenuShortcuts: boolean[];
}

/** One fake proxy per webContents id, the way `fromId` really behaves — two
 * viewers must not end up sharing one guest. */
function installFakeRemote(): { guest: (id?: number) => FakeGuest; fromIdCalls: number[] } {
  const guests = new Map<number, FakeGuest & { contents: unknown }>();
  const fromIdCalls: number[] = [];
  const makeGuest = () => {
    const listeners = new Map<string, Set<GuestListener>>();
    const ignoreMenuShortcuts: boolean[] = [];
    return {
      contents: {
        on: (event: string, listener: GuestListener) => {
          const set = listeners.get(event) ?? new Set();
          set.add(listener);
          listeners.set(event, set);
        },
        removeAllListeners: (event: string) => listeners.delete(event),
        setIgnoreMenuShortcuts: (ignore: boolean) => ignoreMenuShortcuts.push(ignore),
        isDestroyed: () => false,
      },
      emit: (event: string, input: Record<string, unknown>) => {
        for (const listener of listeners.get(event) ?? []) listener(null, input);
      },
      listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
      ignoreMenuShortcuts,
    };
  };
  (window as unknown as { electron: unknown }).electron = {
    remote: {
      webContents: {
        fromId: (id: number) => {
          fromIdCalls.push(id);
          let guest = guests.get(id);
          if (!guest) {
            guest = makeGuest();
            guests.set(id, guest);
          }
          return guest.contents;
        },
      },
    },
  };
  return {
    guest: (id = 77) => {
      let guest = guests.get(id);
      if (!guest) {
        guest = makeGuest();
        guests.set(id, guest);
      }
      return guest;
    },
    fromIdCalls,
  };
}

function guestKey(key: string, code = key) {
  return {
    type: "keyDown",
    code,
    key,
    shift: false,
    alt: false,
    control: false,
    meta: false,
    isAutoRepeat: false,
  };
}

/** Opens a viewer and drives the guest to the point where its id exists. */
async function openViewer(app: App, url = "https://example.com/", guestId = 77) {
  const leaf = app.workspace.getLeaf("tab");
  await leaf.setViewState({ type: "webviewer", state: { url }, active: true });
  const view = leaf.view as WebViewerView;
  const adapter = (view as unknown as { adapter: { getWebContentsId: () => number | null } })
    .adapter;
  // jsdom has no real guest; stand in for the id Electron would report, then
  // fire the attach signal the view configures on.
  adapter.getWebContentsId = () => guestId;
  (
    view as unknown as { adapter: { webContents: { emit: (e: string, p: unknown) => void } } }
  ).adapter.webContents.emit("dom-ready", { url });
  return { leaf, view };
}

async function createApp() {
  const app = new App(document.createElement("div"));
  await app.ready;
  await app.internalPlugins.enable("webviewer");
  return app;
}

afterEach(() => {
  delete (window as unknown as { electron?: unknown }).electron;
});

describe("webviewer guest input", () => {
  it("subscribes to the guest's own webContents once it attaches", async () => {
    const { guest, fromIdCalls } = installFakeRemote();
    const app = await createApp();
    await openViewer(app);

    expect(fromIdCalls).toEqual([77]);
    expect(guest().listenerCount("before-input-event")).toBe(1);
    expect(guest().listenerCount("input-event")).toBe(1);
  });

  it("subscribes once even though dom-ready fires again on every reload", async () => {
    const { guest, fromIdCalls } = installFakeRemote();
    const app = await createApp();
    const { view } = await openViewer(app);
    (
      view as unknown as { adapter: { webContents: { emit: (e: string, p: unknown) => void } } }
    ).adapter.webContents.emit("dom-ready", { url: "https://example.com/" });

    expect(fromIdCalls).toEqual([77]);
    expect(guest().listenerCount("before-input-event")).toBe(1);
  });

  it("replays a guest keystroke into the app keymap", async () => {
    const { guest } = installFakeRemote();
    const app = await createApp();
    await openViewer(app);
    let fired = 0;
    // No modifiers on purpose: "Mod" resolves to Meta or Ctrl by platform, and
    // what is under test is that the key arrives at all.
    app.keymap.rootScope.register([], "F6", () => {
      fired += 1;
      return false;
    });

    guest().emit("before-input-event", guestKey("F6"));

    expect(fired).toBe(1);
  });

  it("carries the modifiers through, so a chord still matches", async () => {
    const { guest } = installFakeRemote();
    const app = await createApp();
    await openViewer(app);
    let plain = 0;
    let chord = 0;
    app.keymap.rootScope.register([], "F7", () => {
      plain += 1;
      return false;
    });
    app.keymap.rootScope.register(["Shift"], "F7", () => {
      chord += 1;
      return false;
    });

    guest().emit("before-input-event", { ...guestKey("F7"), shift: true });

    expect(chord).toBe(1);
    expect(plain).toBe(0);
  });

  it("ignores keyup — replaying it would fire every hotkey twice", async () => {
    const { guest } = installFakeRemote();
    const app = await createApp();
    await openViewer(app);
    let fired = 0;
    app.keymap.rootScope.register([], "F8", () => {
      fired += 1;
      return false;
    });

    guest().emit("before-input-event", { ...guestKey("F8"), type: "keyUp" });

    expect(fired).toBe(0);
  });

  // Ported as-is from app.js, which passes `!!onKeyEvent(...)`. onKeyEvent
  // returns false when handled and undefined when not, so this is false either
  // way — an inverted boolean in Obsidian, kept rather than silently deviated
  // from. This test records that, so a future "fix" is a deliberate one.
  it("calls setIgnoreMenuShortcuts(false) whether or not the key was handled", async () => {
    const { guest } = installFakeRemote();
    const app = await createApp();
    await openViewer(app);
    app.keymap.rootScope.register([], "F9", () => false);

    guest().emit("before-input-event", guestKey("F9"));
    guest().emit("before-input-event", guestKey("F10"));

    expect(guest().ignoreMenuShortcuts).toEqual([false, false]);
  });

  it("makes the clicked guest's leaf active", async () => {
    const { guest } = installFakeRemote();
    const app = await createApp();
    const first = await openViewer(app, "https://first.example/", 41);
    const second = await openViewer(app, "https://second.example/", 42);
    expect(app.workspace.activeLeaf).toBe(second.leaf);

    guest(41).emit("input-event", { type: "mouseMove" });
    expect(app.workspace.activeLeaf).toBe(second.leaf);

    // Each view names its own leaf — no id lookup, because the listener was
    // installed by the view that owns the guest.
    guest(41).emit("input-event", { type: "mouseDown" });
    expect(app.workspace.activeLeaf).toBe(first.leaf);
  });

  it("detaches from the guest when the view closes", async () => {
    const { guest } = installFakeRemote();
    const app = await createApp();
    const { view } = await openViewer(app);
    expect(guest().listenerCount("before-input-event")).toBe(1);

    await view.onClose();

    expect(guest().listenerCount("before-input-event")).toBe(0);
    expect(guest().listenerCount("input-event")).toBe(0);
  });

  it("stays inert in the browser build, where there is no remote", async () => {
    delete (window as unknown as { electron?: unknown }).electron;
    const app = await createApp();
    await expect(openViewer(app)).resolves.toBeDefined();
  });
});

/**
 * The other half of the same problem: a right-click inside the page never
 * reaches the host document either, so the menu has to be driven by the
 * `context-menu` event's `params` — the click's DOM is in another process and
 * `closest("a[href]")` on this side can never see it.
 */
function menuTitles(): string[] {
  return [...document.querySelectorAll(".menu-item-title")].map((el) => el.textContent ?? "");
}

function closeMenus(): void {
  for (const el of document.querySelectorAll(".menu")) el.remove();
}

async function rightClick(app: App, params: Record<string, unknown>, url = "https://example.com/") {
  const { view } = await openViewer(app, url);
  const adapter = (
    view as unknown as {
      adapter: { webContents: { emit: (e: string, p: unknown) => void } };
    }
  ).adapter;
  adapter.webContents.emit("context-menu", { mediaType: "none", x: 0, y: 0, ...params });
  return view;
}

describe("webviewer guest context menu", () => {
  afterEach(closeMenus);

  it("offers the page group when the click hit nothing", async () => {
    installFakeRemote();
    const app = await createApp();
    document.body.appendChild(app.containerEl);
    await rightClick(app, {});

    expect(menuTitles()).toEqual([
      "Back",
      "Forward",
      "Reload",
      "Open in default browser",
      "Select all",
    ]);
    app.containerEl.remove();
  });

  it("offers the link group from params, which host DOM could never supply", async () => {
    installFakeRemote();
    const app = await createApp();
    document.body.appendChild(app.containerEl);
    await rightClick(app, { linkURL: "https://linked.example/page" });

    expect(menuTitles()).toEqual([
      "Open link",
      "Open link in new tab",
      "Open link in new split",
      "Open link in new window",
      "Open link in default browser",
      "Copy link address",
    ]);
    app.containerEl.remove();
  });

  it("offers selection actions, with the query clipped the way the real menu clips it", async () => {
    installFakeRemote();
    const app = await createApp();
    document.body.appendChild(app.containerEl);
    await rightClick(app, { selectionText: "a rather long selection of text" });

    expect(menuTitles()).toEqual(['Search for "a rather long s…"', "Extract selection", "Copy"]);
    app.containerEl.remove();
  });

  it("adds the editing commands only when the click was in an editable field", async () => {
    installFakeRemote();
    const app = await createApp();
    document.body.appendChild(app.containerEl);
    await rightClick(app, { selectionText: "typed", isEditable: true });

    expect(menuTitles()).toContain("Cut");
    expect(menuTitles()).toContain("Paste");
    app.containerEl.remove();
  });

  it("offers the image group, and drops the page group that only fits a bare click", async () => {
    installFakeRemote();
    const app = await createApp();
    document.body.appendChild(app.containerEl);
    await rightClick(app, { mediaType: "image", srcURL: "https://img.example/a.png" });

    expect(menuTitles()).toEqual(["Save image to vault", "Copy image", "Copy image link"]);
    app.containerEl.remove();
  });

  it("silences Chromium's own menu so only ours shows", async () => {
    const { guest } = installFakeRemote();
    const app = await createApp();
    await openViewer(app);

    expect(
      (guest() as unknown as { contents: { noContextMenu?: boolean } }).contents.noContextMenu,
    ).toBe(true);
  });
});

describe("webviewer guest context menu position", () => {
  afterEach(closeMenus);

  // The guest reports the click in its own coordinate space, so any host
  // position derived from it has to undo the guest's zoom, the window's zoom
  // and the device pixel ratio in the right order. A native popup asks the OS
  // where the pointer is instead, which is what the real webviewer's menu does.
  it("pops the native menu at the cursor, naming no coordinate", async () => {
    installFakeRemote();
    const popup = vi.fn();
    const electron = (window as unknown as { electron: Record<string, unknown> }).electron;
    (electron.remote as Record<string, unknown>).Menu = {
      buildFromTemplate: () => ({ on: () => {}, popup }),
    };
    (electron.remote as Record<string, unknown>).getCurrentWebContents = () => ({
      getZoomLevel: () => 0,
    });
    (electron.remote as Record<string, unknown>).getCurrentWindow = () => ({});
    const app = await createApp();
    document.body.appendChild(app.containerEl);

    await rightClick(app, { x: 300, y: 200 });

    expect(popup).toHaveBeenCalledTimes(1);
    const options = popup.mock.calls[0][0] as Record<string, unknown>;
    expect("x" in options).toBe(false);
    expect("y" in options).toBe(false);
    expect(document.querySelector(".menu")).toBeNull();
    app.containerEl.remove();
  });

  it("falls back to a positioned DOM menu when there is no native menu", async () => {
    installFakeRemote();
    const app = await createApp();
    document.body.appendChild(app.containerEl);

    await rightClick(app, { x: 300, y: 200 });

    expect(document.querySelector(".menu")).not.toBeNull();
    app.containerEl.remove();
  });
});
