import { beforeEach, describe, expect, it, vi } from "vitest";

type SyncHandler = (event: { returnValue?: unknown }) => void;
const handlers = new Map<string, SyncHandler>();

vi.mock("electron", () => ({
  ipcMain: {
    on: (channel: string, handler: SyncHandler) => handlers.set(channel, handler),
  },
}));

import { registerFoundationIpc } from "@desktop/foundation-ipc";
import { mainState } from "@desktop/state";

function sendSync(channel: string): unknown {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  const event: { returnValue?: unknown } = {};
  handler(event);
  return event.returnValue;
}

describe("registerFoundationIpc", () => {
  beforeEach(() => {
    handlers.clear();
    mainState.isQuitting = false;
    mainState.fileUrlPrefix = "file://";
    registerFoundationIpc();
  });

  it("registers the boot-critical sync channels", () => {
    expect(handlers.has("file-url")).toBe(true);
    expect(handlers.has("is-quitting")).toBe(true);
  });

  it("file-url returns the current file URL prefix", () => {
    expect(sendSync("file-url")).toBe("file://");
    mainState.fileUrlPrefix = "app://abc123/";
    expect(sendSync("file-url")).toBe("app://abc123/");
  });

  it("is-quitting reflects the quitting flag", () => {
    expect(sendSync("is-quitting")).toBe(false);
    mainState.isQuitting = true;
    expect(sendSync("is-quitting")).toBe(true);
  });
});
