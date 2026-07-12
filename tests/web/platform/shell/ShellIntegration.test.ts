import { afterEach, describe, expect, it, vi } from "vitest";
import { ShellIntegration } from "@web/platform/shell/ShellIntegration";

afterEach(() => {
  delete (globalThis as { electron?: unknown }).electron;
});

describe("ShellIntegration", () => {
  it("uses in-process mocks when not running under Electron", async () => {
    const shell = new ShellIntegration();
    // Mock FileDialogService returns [] for open.
    expect(await shell.bridge.invoke({ channel: "dialog:open", payload: {} })).toEqual([]);
    expect(shell.bridge.hasHandler("request-url")).toBe(false);
  });

  it("forwards bridge channels to electron ipcRenderer.invoke under the shell", async () => {
    const invoke = vi.fn((channel: string) =>
      Promise.resolve(channel === "dialog:open" ? ["/picked/file.md"] : undefined),
    );
    (globalThis as { electron?: unknown }).electron = { ipcRenderer: { invoke } };

    const shell = new ShellIntegration();
    const result = await shell.bridge.invoke({ channel: "dialog:open", payload: { multiple: true } });

    expect(invoke).toHaveBeenCalledWith("dialog:open", { multiple: true });
    expect(result).toEqual(["/picked/file.md"]);
    // request-url is wired only under the shell.
    expect(shell.bridge.hasHandler("request-url")).toBe(true);
  });
});
