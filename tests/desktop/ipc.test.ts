import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createIpcHandlers,
  type IpcDeps,
  type IpcSyncEvent,
  type RequestUrlParams,
  type RequestUrlResult,
} from "@desktop/ipc";

let dir: string;
let trashItem: ReturnType<typeof vi.fn<(path: string) => Promise<void>>>;
let openExternal: ReturnType<typeof vi.fn<(url: string) => void>>;
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
  configHome: "/userData",
};

function makeEvent(senderId = 1): IpcSyncEvent & { replies: Array<[string, unknown]> } {
  const replies: Array<[string, unknown]> = [];
  return {
    sender: { id: senderId },
    replies,
    reply: (channel, payload) => replies.push([channel, payload]),
  };
}

function makeHandlers(extra: Partial<IpcDeps> = {}) {
  return createIpcHandlers({
    paths: PATHS,
    trashItem,
    openExternal,
    performRequest,
    appearance,
    ...extra,
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), "ipc-"));
  trashItem = vi.fn<(path: string) => Promise<void>>(() => Promise.resolve());
  openExternal = vi.fn<(url: string) => void>();
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
  handlers = makeHandlers();
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

describe("IPC boot handshake", () => {
  it("vault answers the config home for every window", () => {
    // Real answered {id, path, home} — which folder this window IS. The
    // workspace form has no per-window folder identity; home is the story.
    const event = makeEvent();
    handlers.vault(event);
    expect(event.returnValue).toEqual({ home: "/userData" });
  });

  it("vault carries the e2e mount seed when configured", () => {
    const seeded = makeHandlers({ seedMounts: ["/tmp/repo-a", "/tmp/repo-b"] });
    const event = makeEvent();
    seeded.vault(event);
    expect(event.returnValue).toEqual({
      home: "/userData",
      mounts: ["/tmp/repo-a", "/tmp/repo-b"],
    });
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
