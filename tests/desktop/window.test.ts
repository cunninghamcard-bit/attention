import { describe, expect, it, vi } from "vitest";

const { openExternal } = vi.hoisted(() => ({ openExternal: vi.fn() }));

vi.mock("electron", () => ({ BrowserWindow: class {}, shell: { openExternal } }));
vi.mock("@electron/remote/main", () => ({ enable: vi.fn(), initialize: vi.fn() }));

import { denyChildWindows } from "@desktop/window";

type WindowOpenHandler = (details: { url: string }) => { action: string };

interface FakeWindow {
  win: unknown;
  handler: () => WindowOpenHandler;
  attachWebview: () => WindowOpenHandler;
  sent: Array<[string, string]>;
}

function fakeWindow(): FakeWindow {
  let captured: WindowOpenHandler | null = null;
  let onAttach: ((event: unknown, guest: unknown) => void) | null = null;
  const sent: Array<[string, string]> = [];
  const win = {
    webContents: {
      setWindowOpenHandler: (handler: WindowOpenHandler) => {
        captured = handler;
      },
      on: (event: string, listener: (event: unknown, guest: unknown) => void) => {
        if (event === "did-attach-webview") onAttach = listener;
      },
      send: (channel: string, url: string) => sent.push([channel, url]),
    },
  };
  const attachWebview = (): WindowOpenHandler => {
    let guestHandler: WindowOpenHandler | null = null;
    onAttach?.(null, {
      setWindowOpenHandler: (handler: WindowOpenHandler) => {
        guestHandler = handler;
      },
    });
    return guestHandler!;
  };
  return { win, handler: () => captured!, attachWebview, sent };
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
