import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, provideAppAdapter } from "@web/app/App";
import { InMemoryAdapter } from "@web/vault/DataAdapter";
import { MountAdapter } from "@web/mount/MountAdapter";

// The bottom-left profile row was real Obsidian's vault switcher (registry
// list + vault-open IPC). The workspace form has no registry: the click menu
// manages THE workspace's roots — add a folder, remove a repository.

// jsdom ships no localStorage; the same stub bootstrap.test.ts installs.
// The mount registry reads it when a repository is removed.
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
});

afterEach(() => {
  provideAppAdapter(undefined);
  delete (globalThis as { electron?: unknown }).electron;
  document.body.querySelectorAll(".menu, .notice").forEach((el) => el.remove());
});

async function openWorkspaceMenu(adapter?: MountAdapter) {
  if (adapter) provideAppAdapter(adapter);
  const app = new App(document.createElement("div"));
  await app.ready;
  const switcherEl = app.workspace.leftSplit.containerEl.querySelector<HTMLElement>(
    ".workspace-drawer-vault-switcher",
  );
  expect(switcherEl).not.toBeNull();
  switcherEl!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const menu = document.body.querySelector<HTMLElement>(".menu");
  return { app, switcherEl: switcherEl!, menu };
}

describe("workspace menu", () => {
  it("is a silent no-op when the vault is not a workspace", async () => {
    // Unit tests boot the App on a plain in-memory adapter; only the
    // workspace (MountAdapter) has roots to manage.
    const { menu } = await openWorkspaceMenu();
    expect(menu).toBeNull();
  });

  it("offers add-folder plus a remove entry per repository, never for Home", async () => {
    const adapter = new MountAdapter([
      { name: "Home", adapter: new InMemoryAdapter() },
      { name: "attention", adapter: new InMemoryAdapter() },
      { name: "Memoh", adapter: new InMemoryAdapter() },
    ]);
    const { menu } = await openWorkspaceMenu(adapter);
    expect(menu).not.toBeNull();
    const titles = [...menu!.querySelectorAll(".menu-item-title")].map((el) => el.textContent);
    expect(titles).toEqual([
      "Add folder to workspace...",
      'Remove "attention" from workspace',
      'Remove "Memoh" from workspace',
    ]);
  });

  it("removes a repository live and keeps Home mounted", async () => {
    const adapter = new MountAdapter([
      { name: "Home", adapter: new InMemoryAdapter() },
      { name: "attention", adapter: new InMemoryAdapter() },
    ]);
    const { menu } = await openWorkspaceMenu(adapter);
    const items = [...menu!.querySelectorAll<HTMLElement>(".menu-item")];
    const remove = items.find((el) =>
      el.querySelector(".menu-item-title")?.textContent?.startsWith('Remove "attention"'),
    );
    remove!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() =>
      expect(adapter.getMounts().map((mount) => mount.name)).toEqual(["Home"]),
    );
  });

  it("tells the browser build that adding folders needs the desktop app", async () => {
    const adapter = new MountAdapter([{ name: "Home", adapter: new InMemoryAdapter() }]);
    const { menu } = await openWorkspaceMenu(adapter);
    const items = [...menu!.querySelectorAll<HTMLElement>(".menu-item")];
    const add = items.find(
      (el) => el.querySelector(".menu-item-title")?.textContent === "Add folder to workspace...",
    );
    add!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() =>
      expect(document.body.querySelector(".notice")?.textContent).toContain("desktop"),
    );
  });

  it("routes the vault-actions help button through App.openHelp", async () => {
    const ipc = { sendSync: vi.fn(), invoke: vi.fn(async () => []) };
    (globalThis as { electron?: unknown }).electron = { ipcRenderer: ipc };
    const app = new App(document.createElement("div"));
    await app.ready;
    const helpEl = app.workspace.leftSplit.containerEl.querySelector<HTMLElement>(
      ".workspace-drawer-vault-actions .clickable-icon",
    );
    expect(helpEl).not.toBeNull();
    helpEl!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ipc.sendSync).toHaveBeenCalledWith("open-url", "https://help.obsidian.md/");
  });

  it("does not register the vault-switch commands the workspace form deleted", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    expect(app.commands.findCommand("app:switch-vault")).toBeUndefined();
    expect(app.commands.findCommand("app:open-another-vault")).toBeUndefined();
    expect(app.commands.findCommand("app:add-folder-to-workspace")).toBeDefined();
  });
});
