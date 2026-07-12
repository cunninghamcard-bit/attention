import { afterEach, describe, expect, it, vi } from "vitest";
import { StarterScreen, type StarterIpc } from "@web/app/starter/StarterScreen";

// The starter (vault chooser) page: recent-vaults sidebar from the vault-list
// IPC (ts-descending), open/create flows through vault-open, and the
// window-closes-itself contract on a `true` ack.

interface FakeIpc extends StarterIpc {
  sendSync: ReturnType<typeof vi.fn<(channel: string, ...args: unknown[]) => unknown>>;
  invoke: ReturnType<typeof vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>>;
}

function makeIpc(vaults: Record<string, { path: string; ts?: number; open?: boolean }>): FakeIpc {
  return {
    sendSync: vi.fn((channel: string, ...args: unknown[]) => {
      switch (channel) {
        case "version":
          return "1.2.3";
        case "vault-list":
          return vaults;
        case "get-default-vault-path":
          return "/docs/Workbench Vault";
        case "vault-open":
          return true;
        case "vault-move":
          return "";
        case "vault-remove": {
          const [path] = args as [string];
          const id = Object.keys(vaults).find((key) => vaults[key].path === path);
          if (!id || vaults[id].open) return false;
          delete vaults[id];
          return true;
        }
        default:
          return undefined;
      }
    }),
    invoke: vi.fn(async () => ["/picked"]),
  };
}

function makeScreen(vaults: Record<string, { path: string; ts?: number; open?: boolean }>) {
  const ipc = makeIpc(vaults);
  const closeWindow = vi.fn();
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const screen = new StarterScreen(parent, ipc, { closeWindow, isWindows: false });
  return { screen, ipc, closeWindow, parent };
}

afterEach(() => {
  document.body.replaceChildren();
});

// The Notice container is module-cached and survives body cleanup with its
// old notices still inside — the newest message is always the last one.
function lastNoticeText(): string | undefined {
  return [...document.body.querySelectorAll(".notice-message")].pop()?.textContent ?? undefined;
}

describe("StarterScreen", () => {
  it("renders recent vaults most-recently-opened first with name and parent path", () => {
    const { parent } = makeScreen({
      old: { path: "/vaults/old-notes", ts: 1 },
      fresh: { path: "/vaults/fresh-notes", ts: 9 },
    });
    const names = [...parent.querySelectorAll(".recent-vaults-list-item-name")].map(
      (el) => el.textContent,
    );
    expect(names).toEqual(["fresh-notes", "old-notes"]);
    const paths = [...parent.querySelectorAll(".recent-vaults-list-item-path")].map(
      (el) => el.textContent,
    );
    expect(paths).toEqual(["/vaults", "/vaults"]);
    expect(parent.querySelector(".quick-start-container")).toHaveProperty("style.display", "none");
  });

  it("hides the sidebar and shows Quick start when the registry is empty", () => {
    const { parent, ipc, closeWindow } = makeScreen({});
    const sidebar = parent.querySelector<HTMLElement>(".recent-vaults");
    expect(sidebar?.style.display).toBe("none");
    const quickStart = parent.querySelector<HTMLElement>(".quick-start-container button");
    expect(quickStart?.textContent).toBe("Quick start");
    quickStart!.click();
    expect(ipc.sendSync).toHaveBeenCalledWith("vault-open", "/docs/Workbench Vault", true);
    expect(closeWindow).toHaveBeenCalled();
  });

  it("opens a clicked vault through vault-open and closes the window on true", () => {
    const { parent, ipc, closeWindow } = makeScreen({ a: { path: "/vaults/demo", ts: 1 } });
    parent.querySelector<HTMLElement>(".recent-vaults-list-item")!.click();
    expect(ipc.sendSync).toHaveBeenCalledWith("vault-open", "/vaults/demo", false);
    expect(closeWindow).toHaveBeenCalled();
  });

  it("shows the failure Notice and stays open when vault-open acks an error", () => {
    const { parent, ipc, closeWindow } = makeScreen({ a: { path: "/vaults/demo", ts: 1 } });
    ipc.sendSync.mockImplementation((channel: string) =>
      channel === "vault-open" ? "folder not found" : {},
    );
    parent.querySelector<HTMLElement>(".recent-vaults-list-item")!.click();
    expect(closeWindow).not.toHaveBeenCalled();
    expect(lastNoticeText()).toContain("Failed to open.");
  });

  it("walks the create pane: browse location, name, create=true IPC, close", async () => {
    const { parent, ipc, closeWindow } = makeScreen({ a: { path: "/vaults/demo", ts: 1 } });
    const createAction = [
      ...parent.querySelectorAll<HTMLButtonElement>(".mod-open-vault button"),
    ].find((el) => el.textContent === "Create");
    createAction!.click();
    const pane = parent.querySelector<HTMLElement>(".mod-create-vault");
    expect(pane).not.toBeNull();
    expect(pane!.querySelector(".setting-item-heading .setting-item-name")?.textContent).toBe(
      "Create local vault",
    );

    // Create without a name: validation Notice, no IPC.
    pane!.querySelector<HTMLButtonElement>(".button-container button")!.click();
    expect(lastNoticeText()).toBe("Vault name cannot be empty.");
    expect(ipc.sendSync).not.toHaveBeenCalledWith("vault-open", expect.anything(), true);

    const browse = [...pane!.querySelectorAll<HTMLButtonElement>("button")].find(
      (el) => el.textContent === "Browse",
    );
    browse!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pane!.querySelector(".u-pop")?.textContent).toBe("/picked");

    const nameInput = pane!.querySelector<HTMLInputElement>("input[type='text']");
    nameInput!.value = "My Vault";
    nameInput!.dispatchEvent(new Event("input"));
    pane!.querySelector<HTMLButtonElement>(".button-container button")!.click();
    expect(ipc.sendSync).toHaveBeenCalledWith("vault-open", "/picked/My Vault", true);
    expect(closeWindow).toHaveBeenCalled();
  });

  it("removes a vault from the list and purges its localStorage keys", () => {
    const { parent, ipc } = makeScreen({
      gone: { path: "/vaults/gone", ts: 2 },
      kept: { path: "/vaults/kept", ts: 1 },
    });
    // Node's experimental localStorage global keeps jsdom from installing a
    // real one — a Map-backed Storage stub covers the purge contract.
    const backing = new Map<string, string>();
    const storageStub = {
      get length() {
        return backing.size;
      },
      key: (index: number) => [...backing.keys()][index] ?? null,
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => void backing.set(key, value),
      removeItem: (key: string) => void backing.delete(key),
      clear: () => backing.clear(),
    };
    Object.defineProperty(window, "localStorage", { configurable: true, value: storageStub });
    storageStub.setItem("gone-history", "x");
    storageStub.setItem("kept-history", "y");
    const item = [...parent.querySelectorAll<HTMLElement>(".recent-vaults-list-item")].find(
      (el) => el.querySelector(".recent-vaults-list-item-name")?.textContent === "gone",
    );
    item!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    const remove = [...document.body.querySelectorAll<HTMLElement>(".menu-item")].find(
      (el) => el.querySelector(".menu-item-title")?.textContent === "Remove from list",
    );
    remove!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ipc.sendSync).toHaveBeenCalledWith("vault-remove", "/vaults/gone");
    expect(storageStub.getItem("gone-history")).toBeNull();
    expect(storageStub.getItem("kept-history")).toBe("y");
    const names = [...parent.querySelectorAll(".recent-vaults-list-item-name")].map(
      (el) => el.textContent,
    );
    expect(names).toEqual(["kept"]);
  });
});
