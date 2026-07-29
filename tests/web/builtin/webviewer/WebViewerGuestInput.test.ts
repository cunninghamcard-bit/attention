/**
 * Input: None
 * Output: test suite
 * Pos: Test code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { afterEach, describe, expect, it } from "vitest";
import { App } from "@web/app/App";
import { WebViewerView } from "@web/builtin/webviewer/WebViewerPlugin";

/**
 * A `<webview>` guest is its own webContents: nothing typed inside a page the
 * Web viewer shows reaches this document, so every app hotkey — Cmd+W is how
 * this surfaced — is dead while the guest holds focus. Main forwards the
 * guest's `before-input-event` over IPC and the plugin replays it into the one
 * keymap. This exercises that renderer half against a fake ipcRenderer.
 */

type IpcListener = (event: unknown, payload: unknown) => void;

interface FakeIpc {
  send: (channel: string, payload: unknown) => void;
  channels: () => string[];
}

function installFakeIpc(): FakeIpc {
  const listeners = new Map<string, Set<IpcListener>>();
  (window as unknown as { electron: unknown }).electron = {
    ipcRenderer: {
      on: (channel: string, listener: IpcListener) => {
        const set = listeners.get(channel) ?? new Set();
        set.add(listener);
        listeners.set(channel, set);
      },
      removeListener: (channel: string, listener: IpcListener) => {
        listeners.get(channel)?.delete(listener);
      },
    },
  };
  return {
    send: (channel, payload) => {
      for (const listener of listeners.get(channel) ?? []) listener(null, payload);
    },
    channels: () => [...listeners.keys()],
  };
}

function guestKey(key: string, code = `Key${key.toUpperCase()}`) {
  return { code, key, shift: false, alt: false, control: false, meta: false, isAutoRepeat: false };
}

async function createApp() {
  const ipc = installFakeIpc();
  const app = new App(document.createElement("div"));
  await app.ready;
  await app.internalPlugins.enable("webviewer");
  return { app, ipc };
}

afterEach(() => {
  delete (window as unknown as { electron?: unknown }).electron;
});

describe("webviewer guest input", () => {
  it("subscribes to the guest input channels when the plugin enables", async () => {
    const { ipc } = await createApp();
    expect(ipc.channels()).toContain("webview-input-key");
    expect(ipc.channels()).toContain("webview-input-focus");
  });

  it("replays a forwarded guest keystroke into the app keymap", async () => {
    const { app, ipc } = await createApp();
    let fired = 0;
    // Registered without modifiers on purpose: "Mod" resolves to Meta or Ctrl
    // by platform, and what is under test is that the key arrives at all.
    app.keymap.rootScope.register([], "F6", () => {
      fired += 1;
      return false;
    });

    ipc.send("webview-input-key", guestKey("F6", "F6"));

    expect(fired).toBe(1);
  });

  it("carries the modifiers through, so a chord still matches", async () => {
    const { app, ipc } = await createApp();
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

    ipc.send("webview-input-key", { ...guestKey("F7", "F7"), shift: true });

    expect(chord).toBe(1);
    expect(plain).toBe(0);
  });

  it("ignores a malformed payload instead of throwing at the IPC boundary", async () => {
    const { ipc } = await createApp();
    expect(() => ipc.send("webview-input-key", null)).not.toThrow();
    expect(() => ipc.send("webview-input-key", { code: "KeyA" })).not.toThrow();
    expect(() => ipc.send("webview-input-focus", "not-an-id")).not.toThrow();
  });

  it("makes the clicked guest's leaf active", async () => {
    const { app, ipc } = await createApp();
    const first = app.workspace.getLeaf("tab");
    await first.setViewState({
      type: "webviewer",
      state: { url: "https://first.example/" },
      active: true,
    });
    const second = app.workspace.getLeaf("tab");
    await second.setViewState({
      type: "webviewer",
      state: { url: "https://second.example/" },
      active: true,
    });
    // jsdom has no real guest, so stand in for the id main would report.
    Object.defineProperty(first.view as WebViewerView, "webContentsId", { value: 41 });
    Object.defineProperty(second.view as WebViewerView, "webContentsId", { value: 42 });
    expect(app.workspace.activeLeaf).toBe(second);

    ipc.send("webview-input-focus", 41);

    expect(app.workspace.activeLeaf).toBe(first);
  });
});
