import { describe, expect, it, vi } from "vitest";

const { openExternal } = vi.hoisted(() => ({ openExternal: vi.fn() }));

vi.mock("electron", () => ({ BrowserWindow: class {}, shell: { openExternal } }));
vi.mock("@electron/remote/main", () => ({ enable: vi.fn(), initialize: vi.fn() }));

import { denyChildWindows, forwardWebviewInput } from "@desktop/window";

type WindowOpenHandler = (details: { url: string }) => { action: string };
type GuestListener = (event: unknown, input: Record<string, unknown>) => void;

interface FakeWindow {
  win: unknown;
  handler: () => WindowOpenHandler;
  attachWebview: () => WindowOpenHandler;
  /** Fires every `did-attach-webview` listener, then drives the guest's own
   * events — the shape `forwardWebviewInput` subscribes to. */
  attachGuest: (id?: number) => { emit: (event: string, input: Record<string, unknown>) => void };
  sent: Array<[string, unknown]>;
}

function fakeWindow(): FakeWindow {
  let captured: WindowOpenHandler | null = null;
  const attachListeners: Array<(event: unknown, guest: unknown) => void> = [];
  const sent: Array<[string, unknown]> = [];
  const win = {
    webContents: {
      setWindowOpenHandler: (handler: WindowOpenHandler) => {
        captured = handler;
      },
      on: (event: string, listener: (event: unknown, guest: unknown) => void) => {
        if (event === "did-attach-webview") attachListeners.push(listener);
      },
      send: (channel: string, payload: unknown) => sent.push([channel, payload]),
    },
  };
  const attachWebview = (): WindowOpenHandler => {
    let guestHandler: WindowOpenHandler | null = null;
    for (const listener of attachListeners) {
      listener(null, {
        id: 7,
        isDestroyed: () => false,
        on: () => {},
        setWindowOpenHandler: (handler: WindowOpenHandler) => {
          guestHandler = handler;
        },
      });
    }
    return guestHandler!;
  };
  const attachGuest = (id = 7) => {
    const guestListeners = new Map<string, GuestListener>();
    for (const listener of attachListeners) {
      listener(null, {
        id,
        isDestroyed: () => false,
        setWindowOpenHandler: () => {},
        on: (event: string, guestListener: GuestListener) => {
          guestListeners.set(event, guestListener);
        },
      });
    }
    return {
      emit: (event: string, input: Record<string, unknown>) =>
        guestListeners.get(event)?.(null, input),
    };
  };
  return { win, handler: () => captured!, attachWebview, attachGuest, sent };
}

describe("denyChildWindows", () => {
  it("sends external links to the OS browser instead of a child window", () => {
    openExternal.mockClear();
    const { win, handler } = fakeWindow();
    denyChildWindows(win as never);

    expect(handler()({ url: "https://obsidian.md" })).toEqual({ action: "deny" });
    expect(openExternal).toHaveBeenCalledWith("https://obsidian.md");
  });

  it("denies non-http child windows without handing them to the OS", () => {
    openExternal.mockClear();
    const { win, handler } = fakeWindow();
    denyChildWindows(win as never);

    expect(handler()({ url: "file:///etc/passwd" })).toEqual({ action: "deny" });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("keeps a webview pop-up in the Web viewer instead of opening a native window", () => {
    openExternal.mockClear();
    const fake = fakeWindow();
    denyChildWindows(fake.win as never);
    const guestHandler = fake.attachWebview();

    expect(guestHandler({ url: "https://github.com/obsidianmd" })).toEqual({ action: "deny" });
    expect(fake.sent).toEqual([["webview-open-url", "https://github.com/obsidianmd"]]);
    expect(openExternal).not.toHaveBeenCalled();
  });
});

// A guest webContents keeps its own keyboard, so app hotkeys are dead while a
// page in the Web viewer has focus (Cmd+W is how this surfaced).
// `before-input-event` is the only place main can see those keys.
describe("forwardWebviewInput", () => {
  it("forwards a guest keydown to the renderer with its modifiers", () => {
    const fake = fakeWindow();
    forwardWebviewInput(fake.win as never);
    const guest = fake.attachGuest();

    guest.emit("before-input-event", {
      type: "keyDown",
      code: "KeyW",
      key: "w",
      shift: false,
      alt: false,
      control: false,
      meta: true,
      isAutoRepeat: false,
    });

    expect(fake.sent).toEqual([
      [
        "webview-input-key",
        {
          code: "KeyW",
          key: "w",
          shift: false,
          alt: false,
          control: false,
          meta: true,
          isAutoRepeat: false,
        },
      ],
    ]);
  });

  it("ignores keyup — replaying it would fire every hotkey twice", () => {
    const fake = fakeWindow();
    forwardWebviewInput(fake.win as never);
    const guest = fake.attachGuest();

    guest.emit("before-input-event", { type: "keyUp", code: "KeyW", key: "w" });

    expect(fake.sent).toEqual([]);
  });

  it("reports the guest id on mouseDown so the renderer can activate its leaf", () => {
    const fake = fakeWindow();
    forwardWebviewInput(fake.win as never);
    const guest = fake.attachGuest(41);

    guest.emit("input-event", { type: "mouseMove" });
    guest.emit("input-event", { type: "mouseDown" });

    expect(fake.sent).toEqual([["webview-input-focus", 41]]);
  });
});
