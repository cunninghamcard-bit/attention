import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { JsonStore } from "@desktop/json-store";
import { VaultRegistry } from "@desktop/vault-registry";
import {
  createIpcHandlers,
  type IpcDeps,
  type IpcSyncEvent,
  type RequestUrlParams,
  type RequestUrlResult,
} from "@desktop/ipc";
import type { ObsidianSettings } from "@desktop/settings";

let dir: string;
let registry: VaultRegistry;
let openVault: ReturnType<typeof vi.fn<(id: string, focus?: boolean) => unknown>>;
let openSet: Set<string>;
let webContentsToVault: Map<number, string>;
let trashItem: ReturnType<typeof vi.fn<(path: string) => Promise<void>>>;
let openExternal: ReturnType<typeof vi.fn<(url: string) => void>>;
let openStarter: ReturnType<typeof vi.fn<() => void>>;
let performRequest: ReturnType<typeof vi.fn<(p: RequestUrlParams) => Promise<RequestUrlResult>>>;
let appearance: NonNullable<IpcDeps["appearance"]>;
let handlers: Record<string, (event: IpcSyncEvent, ...args: unknown[]) => void>;

const PATHS: IpcDeps["paths"] = {
  resources: "/res",
  version: "9.9.9",
  desktopDir: "/desktop",
  documentsDir: "/documents",
  sandboxVaultPath: "/userData/Obsidian Sandbox",
  defaultVaultPath: "/documents/Obsidian Vault",
};

function makeEvent(senderId = 1): IpcSyncEvent & { replies: Array<[string, unknown]> } {
  const replies: Array<[string, unknown]> = [];
  return {
    sender: { id: senderId },
    replies,
    reply: (channel, payload) => replies.push([channel, payload]),
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), "ipc-"));
  const store = new JsonStore(join(dir, "userData"));
  const settings: ObsidianSettings = {};
  registry = new VaultRegistry(settings, store, () => {});
  openVault = vi.fn<(id: string, focus?: boolean) => unknown>();
  openSet = new Set();
  webContentsToVault = new Map();
  trashItem = vi.fn<(path: string) => Promise<void>>(() => Promise.resolve());
  openExternal = vi.fn<(url: string) => void>();
  openStarter = vi.fn<() => void>();
  performRequest = vi.fn<(p: RequestUrlParams) => Promise<RequestUrlResult>>(() =>
    Promise.resolve({ status: 200, headers: {}, body: new ArrayBuffer(0) }),
  );
  appearance = {
    frame: vi.fn((value) => value ?? "hidden"),
    disableGpu: vi.fn((value) => value ?? false),
    getIcon: vi.fn(() => "data:image/png;base64,icon"),
    setIcon: vi.fn((path) => (path ? "data:image/png;base64,updated" : null)),
    relaunch: vi.fn(),
  };

  handlers = createIpcHandlers({
    registry,
    vaultWindows: {
      openVault,
      isOpen: (id) => openSet.has(id),
      vaultIdForWebContents: (wcId) => webContentsToVault.get(wcId) ?? null,
    },
    paths: PATHS,
    openStarter,
    trashItem,
    openExternal,
    performRequest,
    existsSync: fs.existsSync,
    mkdirp: (p) => fs.mkdirSync(p, { recursive: true }),
    appearance,
  });
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("IPC env getters", () => {
  it("return the configured paths and version", () => {
    for (const [channel, expected] of [
      ["resources", "/res"],
      ["version", "9.9.9"],
      ["desktop-dir", "/desktop"],
      ["documents-dir", "/documents"],
      ["get-documents-path", "/documents"],
      ["get-sandbox-vault-path", "/userData/Obsidian Sandbox"],
      ["get-default-vault-path", "/documents/Obsidian Vault"],
    ] as const) {
      const event = makeEvent();
      handlers[channel](event);
      expect(event.returnValue).toBe(expected);
    }
  });
});

describe("IPC vault channels", () => {
  it("vault-list returns the whole registry", () => {
    const vaultPath = join(dir, "V");
    fs.mkdirSync(vaultPath);
    registry.registerPath(vaultPath);
    const event = makeEvent();
    handlers["vault-list"](event);
    expect(event.returnValue).toBe(registry.vaults);
  });

  it("vault maps the sender webContents to {id, path}, else {}", () => {
    const vaultPath = join(dir, "V");
    fs.mkdirSync(vaultPath);
    const { id } = registry.registerPath(vaultPath) as { id: string };
    webContentsToVault.set(7, id);

    const known = makeEvent(7);
    handlers.vault(known);
    expect(known.returnValue).toEqual({ id, path: resolve(vaultPath) });

    const unknown = makeEvent(99);
    handlers.vault(unknown);
    expect(unknown.returnValue).toEqual({});
  });

  it("vault-open registers and opens the window, returning true", () => {
    const vaultPath = join(dir, "New");
    fs.mkdirSync(vaultPath);
    const event = makeEvent();
    handlers["vault-open"](event, vaultPath, false);
    expect(event.returnValue).toBe(true);
    expect(openVault).toHaveBeenCalledTimes(1);
  });

  it("vault-open with create=true mkdirs, or reports an existing vault", () => {
    const vaultPath = join(dir, "Created");
    const create = makeEvent();
    handlers["vault-open"](create, vaultPath, true);
    expect(create.returnValue).toBe(true);
    expect(fs.existsSync(vaultPath)).toBe(true);

    const again = makeEvent();
    handlers["vault-open"](again, vaultPath, true);
    expect(again.returnValue).toBe("Vault already exists");
  });

  it("vault-open surfaces the registry error string", () => {
    const event = makeEvent();
    handlers["vault-open"](event, join(dir, "missing"), false);
    expect(event.returnValue).toBe("folder not found");
    expect(openVault).not.toHaveBeenCalled();
  });

  it("vault-remove/vault-move respect the open guard", () => {
    const vaultPath = join(dir, "Guarded");
    fs.mkdirSync(vaultPath);
    const { id } = registry.registerPath(vaultPath) as { id: string };
    const resolved = registry.vaults[id].path;
    openSet.add(id);

    const remove = makeEvent();
    handlers["vault-remove"](remove, resolved);
    expect(remove.returnValue).toBe(false);

    const move = makeEvent();
    handlers["vault-move"](move, resolved, join(dir, "Moved"));
    expect(move.returnValue).toBe("EVAULTOPEN");
  });

  it("starter opens the vault chooser and acks null (sync)", () => {
    const event = makeEvent();
    handlers.starter(event);
    expect(openStarter).toHaveBeenCalledTimes(1);
    expect(event.returnValue).toBeNull();
  });
});

describe("IPC actions", () => {
  it("persists desktop appearance channels and relaunches", () => {
    const frame = makeEvent();
    handlers.frame(frame, "native");
    expect(appearance.frame).toHaveBeenCalledWith("native");
    expect(frame.returnValue).toBe("native");

    const gpu = makeEvent();
    handlers["disable-gpu"](gpu, true);
    expect(appearance.disableGpu).toHaveBeenCalledWith(true);
    expect(gpu.returnValue).toBe(true);

    const getIcon = makeEvent();
    handlers["get-icon"](getIcon);
    expect(getIcon.returnValue).toBe("data:image/png;base64,icon");
    const setIcon = makeEvent();
    handlers["set-icon"](setIcon, "/tmp/icon.png");
    expect(appearance.setIcon).toHaveBeenCalledWith("/tmp/icon.png");
    expect(setIcon.returnValue).toBe("data:image/png;base64,updated");

    handlers.relaunch(makeEvent());
    expect(appearance.relaunch).toHaveBeenCalledOnce();
  });

  it("trash acks true only after trashItem settles, false on failure", async () => {
    // Real handler shape: async, returnValue set after shell.trashItem — the
    // renderer's sendSync blocks until then, so deletes are strictly ordered.
    const event = makeEvent();
    await handlers.trash(event, "/some/file.md");
    expect(trashItem).toHaveBeenCalledWith("/some/file.md");
    expect(event.returnValue).toBe(true);

    trashItem.mockRejectedValueOnce(new Error("locked"));
    const failed = makeEvent();
    await handlers.trash(failed, "/other/file.md");
    expect(failed.returnValue).toBe(false);
  });

  it("open-url forwards string urls to openExternal", () => {
    handlers["open-url"](makeEvent(), "https://obsidian.md");
    expect(openExternal).toHaveBeenCalledWith("https://obsidian.md");
    openExternal.mockClear();
    handlers["open-url"](makeEvent(), 123 as unknown);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("request-url replies on the given reply id with the result", async () => {
    const event = makeEvent();
    handlers["request-url"](event, "reply-42", { url: "https://x" });
    await vi.waitFor(() => expect(event.replies).toHaveLength(1));
    expect(event.replies[0][0]).toBe("reply-42");
    expect(event.replies[0][1]).toMatchObject({ status: 200 });
  });

  it("request-url replies with {error} when the transport rejects", async () => {
    performRequest.mockRejectedValueOnce(new Error("boom"));
    const event = makeEvent();
    handlers["request-url"](event, "r", { url: "https://x" });
    await vi.waitFor(() => expect(event.replies).toHaveLength(1));
    expect(event.replies[0][1]).toHaveProperty("error");
  });
});
