import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

describe("App protocol handlers", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    });
    Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
    document.body.querySelectorAll(".notice").forEach((el) => el.remove());
  });

  it("opens files from workbench://open with subpath and paneType", async () => {
    const app = new App(document.createElement("div"));
    await app.vault.create("Target.md", "# Heading#Child");

    await app.uriRouter.handleUri("workbench://open?file=Target%23Heading%23Child%7CAlias&paneType=tab");

    expect((app.workspace.activeLeaf?.view as { file?: { path: string } | null } | null)?.file?.path).toBe("Target.md");
    expect(app.workspace.activeLeaf?.view?.getEphemeralState()).toEqual({ subpath: "Heading#Child", line: 0 });
    expect(document.body.textContent).toContain("Opened Target.md");
  });

  it("opens global search from workbench://search with the query", async () => {
    const app = new App(document.createElement("div"));
    await app.corePluginsReady;

    await app.uriRouter.handleUri("workbench://search?query=needle");

    expect(app.workspace.activeLeaf?.view?.getViewType()).toBe("search");
    expect((app.workspace.activeLeaf?.view as { getQuery?: () => string } | null)?.getQuery?.()).toBe("needle");
  });

  it("creates, appends, overwrites, and silently updates files from workbench://new", async () => {
    const app = new App(document.createElement("div"));

    await app.uriRouter.handleUri(`workbench://new?${new URLSearchParams({ name: "Protocol", content: "Hello", paneType: "tab" })}`);

    const created = app.vault.getFileByPath("Protocol.md");
    expect(created).not.toBeNull();
    expect(created ? await app.vault.read(created) : "").toBe("Hello");
    expect((app.workspace.activeLeaf?.view as { file?: { path: string } | null } | null)?.file?.path).toBe("Protocol.md");

    await app.uriRouter.handleUri(`workbench://new?${new URLSearchParams({ name: "Protocol", append: "true", content: "World", silent: "true" })}`);

    expect(created ? await app.vault.read(created) : "").toBe("Hello\n\nWorld");

    await app.uriRouter.handleUri(`workbench://new?${new URLSearchParams({ file: "Protocol.md", overwrite: "true", content: "Replaced", silent: "true" })}`);

    expect(created ? await app.vault.read(created) : "").toBe("Replaced");
  });

  it("reads clipboard content for workbench://new when clipboard is requested", async () => {
    const app = new App(document.createElement("div"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: vi.fn().mockResolvedValue("Clipboard text") },
    });

    await app.uriRouter.handleUri("workbench://new?name=Clipboard&clipboard=true&silent=true");

    const file = app.vault.getFileByPath("Clipboard.md");
    expect(file ? await app.vault.read(file) : "").toBe("Clipboard text");
  });

  it("runs x-success callbacks for workbench://new when URI callbacks are enabled", async () => {
    const app = new App(document.createElement("div"));
    const open = vi.fn();
    Object.defineProperty(window, "open", { configurable: true, value: open });
    app.vault.setConfig("uriCallbacks", true);

    await app.uriRouter.handleUri(`workbench://new?${new URLSearchParams({
      name: "Callback",
      content: "Done",
      silent: "true",
      "x-success": "callback://created?token=1",
    })}`);

    expect(open).toHaveBeenCalledOnce();
    const url = new URL(String(open.mock.calls[0]?.[0]));
    expect(url.protocol).toBe("callback:");
    expect(url.searchParams.get("token")).toBe("1");
    expect(url.searchParams.get("name")).toBe("Callback");
    expect(url.searchParams.get("url")).toBe("workbench://open?vault=In-memory&file=Callback");
  });

  it("copies the active file address or opens x-error from hook-get-address", async () => {
    const app = new App(document.createElement("div"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    const open = vi.fn();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    Object.defineProperty(window, "open", { configurable: true, value: open });
    app.vault.setConfig("uriCallbacks", true);

    const file = await app.vault.create("Address.md", "address");
    await app.workspace.openFile(file, { active: true });
    await app.uriRouter.handleUri("workbench://hook-get-address");

    expect(writeText).toHaveBeenCalledWith("[Address](workbench://open?vault=In-memory&file=Address)");

    await app.workspace.activeLeaf?.setViewState({ type: "empty", active: true });
    await app.uriRouter.handleUri(`workbench://hook-get-address?${new URLSearchParams({ "x-error": "callback://error" })}`);

    expect(open).toHaveBeenCalledOnce();
    const errorUrl = new URL(String(open.mock.calls[0]?.[0]));
    expect(errorUrl.searchParams.get("errorCode")).toBe("NotFound");
    expect(errorUrl.searchParams.get("errorMessage")).toBe("No file is open at the moment");
  });

  it("ignores hook-get-address while URI callbacks are disabled", async () => {
    const app = new App(document.createElement("div"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    const open = vi.fn();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    Object.defineProperty(window, "open", { configurable: true, value: open });

    const file = await app.vault.create("Disabled.md", "disabled");
    await app.workspace.openFile(file, { active: true });
    await app.uriRouter.handleUri("workbench://hook-get-address");
    await app.workspace.activeLeaf?.setViewState({ type: "empty", active: true });
    await app.uriRouter.handleUri(`workbench://hook-get-address?${new URLSearchParams({ "x-error": "callback://error" })}`);

    expect(writeText).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});
