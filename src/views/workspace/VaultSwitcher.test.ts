import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";

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
  const switcherEl = app.workspace.leftSplit.containerEl.querySelector<HTMLElement>(".workspace-drawer-vault-switcher");
  expect(switcherEl).not.toBeNull();
  switcherEl!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const menu = document.body.querySelector<HTMLElement>(".menu");
  return { app, switcherEl: switcherEl!, menu };
}

describe("vault switcher menu", () => {
  it("is a silent no-op in browser builds without the electron bridge", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const switcherEl = app.workspace.leftSplit.containerEl.querySelector<HTMLElement>(".workspace-drawer-vault-switcher");
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
    expect(titles).toContain("Manage vaults...");
    const checked = menu!.querySelector(".menu-item.mod-checked .menu-item-title");
    expect(checked?.textContent).toBe("demo");
  });

  it("opens the starter through the sync starter IPC from Manage vaults...", async () => {
    const ipc = installIpc();
    const { menu } = await openSwitcherMenu();
    const items = [...menu!.querySelectorAll<HTMLElement>(".menu-item")];
    const manage = items.find((el) => el.querySelector(".menu-item-title")?.textContent === "Manage vaults...");
    manage!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ipc.sendSync).toHaveBeenCalledWith("starter");
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
