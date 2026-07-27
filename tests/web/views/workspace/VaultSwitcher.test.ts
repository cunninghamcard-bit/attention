import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";

// The bottom-left vault switcher mirrors the real click menu: registered
// vaults by folder name, current one checked, vault-open IPC on selection,
// then a separator and the open-another-vault entry.

interface IpcStub {
  sendSync: ReturnType<typeof vi.fn>;
  invoke: ReturnType<typeof vi.fn>;
}

function installIpc(): IpcStub {
  const ipc: IpcStub = {
    sendSync: vi.fn((channel: string) => {
      if (channel === "vault") return { path: "/vaults/demo" };
      if (channel === "vault-list") {
        return {
          a: { path: "/vaults/demo" },
          b: { path: "/vaults/notes" },
        };
      }
      return true;
    }),
    invoke: vi.fn(async () => []),
  };
  (globalThis as { electron?: unknown }).electron = { ipcRenderer: ipc };
  return ipc;
}

afterEach(() => {
  delete (globalThis as { electron?: unknown }).electron;
  document.body.querySelectorAll(".menu").forEach((el) => el.remove());
});

async function openSwitcherMenu() {
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

describe("vault switcher menu", () => {
  it("is a silent no-op in browser builds without the electron bridge", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const switcherEl = app.workspace.leftSplit.containerEl.querySelector<HTMLElement>(
      ".workspace-drawer-vault-switcher",
    );
    switcherEl!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.body.querySelector(".menu")).toBeNull();
  });

  it("lists registered vaults with the current one checked", async () => {
    installIpc();
    const { menu } = await openSwitcherMenu();
    expect(menu).not.toBeNull();
    const titles = [...menu!.querySelectorAll(".menu-item-title")].map((el) => el.textContent);
    expect(titles).toContain("demo");
    expect(titles).toContain("notes");
    expect(titles).toContain("Open folder...");
    const checked = menu!.querySelector(".menu-item.mod-checked .menu-item-title");
    expect(checked?.textContent).toBe("demo");
  });

  it("routes the vault-actions help button through App.openHelp", async () => {
    const ipc = installIpc();
    const app = new App(document.createElement("div"));
    await app.ready;
    const helpEl = app.workspace.leftSplit.containerEl.querySelector<HTMLElement>(
      ".workspace-drawer-vault-actions .clickable-icon",
    );
    expect(helpEl).not.toBeNull();
    helpEl!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ipc.sendSync).toHaveBeenCalledWith("open-url", "https://help.obsidian.md/");
  });

  it("opens a folder through the system picker, then vault-open", async () => {
    const ipc = installIpc();
    ipc.invoke = vi.fn(async () => ["/vaults/picked"]);
    const { menu } = await openSwitcherMenu();
    const items = [...menu!.querySelectorAll<HTMLElement>(".menu-item")];
    const open = items.find(
      (el) => el.querySelector(".menu-item-title")?.textContent === "Open folder...",
    );
    open!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    // No chooser screen in between: the OS picker IS the surface.
    expect(ipc.invoke).toHaveBeenCalledWith("dialog:open", {
      title: "Open folder",
      directory: true,
    });
    expect(ipc.sendSync).toHaveBeenCalledWith("vault-open", "/vaults/picked", false);
  });

  it("opens the picked vault through the vault-open IPC and not for the current one", async () => {
    const ipc = installIpc();
    const { menu } = await openSwitcherMenu();
    const items = [...menu!.querySelectorAll<HTMLElement>(".menu-item")];
    const notes = items.find((el) => el.querySelector(".menu-item-title")?.textContent === "notes");
    notes!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ipc.sendSync).toHaveBeenCalledWith("vault-open", "/vaults/notes", false);
  });
});
