import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  kill(signal?: string): boolean {
    this.killed = true;
    this.emit("__kill", signal);
    return true;
  }
}

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  default: { spawn: (...args: unknown[]) => spawnMock(...args) },
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { resolveLoomSidecarConfig, LoomSidecar } from "@desktop/loom-sidecar";

describe("resolveLoomSidecarConfig", () => {
  it("is unconfigured (no spawn, no external url) by default", () => {
    const config = resolveLoomSidecarConfig("/data", {});
    expect(config.bin).toBeNull();
    expect(config.externalUrl).toBeNull();
    expect(config.dbPath).toBe("/data/loom/loom.db");
  });

  it("reads LOOM_SIDECAR_BIN and LOOM_EXTERNAL_URL from env", () => {
    const config = resolveLoomSidecarConfig("/data", {
      LOOM_SIDECAR_BIN: "/usr/local/bin/loom",
      LOOM_EXTERNAL_URL: "http://127.0.0.1:8790",
    });
    expect(config.bin).toBe("/usr/local/bin/loom");
    expect(config.externalUrl).toBe("http://127.0.0.1:8790");
  });
});

describe("LoomSidecar", () => {
  afterEach(() => {
    vi.useRealTimers();
    spawnMock.mockReset();
  });

  it("skips spawning entirely when unconfigured", () => {
    const onUrlChange = vi.fn();
    new LoomSidecar({ bin: null, externalUrl: null, dbPath: "/x" }, onUrlChange).start();
    expect(spawnMock).not.toHaveBeenCalled();
    expect(onUrlChange).not.toHaveBeenCalled();
  });

  it("uses LOOM_EXTERNAL_URL without spawning", () => {
    const onUrlChange = vi.fn();
    new LoomSidecar(
      { bin: "/bin/loom", externalUrl: "http://127.0.0.1:8790", dbPath: "/x" },
      onUrlChange,
    ).start();
    expect(spawnMock).not.toHaveBeenCalled();
    expect(onUrlChange).toHaveBeenCalledWith("http://127.0.0.1:8790");
  });

  it("spawns the configured binary and parses the JSON ready line", () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const onUrlChange = vi.fn();

    new LoomSidecar(
      { bin: "/bin/loom", externalUrl: null, dbPath: "/data/loom/loom.db" },
      onUrlChange,
    ).start();

    expect(spawnMock).toHaveBeenCalledWith(
      "/bin/loom",
      ["serve", "-port", "0", "-db", "/data/loom/loom.db"],
      expect.objectContaining({ env: expect.any(Object) }),
    );

    child.stdout.write('{"event":"ready","port":54321,"url":"http://127.0.0.1:54321"}\n');
    expect(onUrlChange).toHaveBeenCalledWith("http://127.0.0.1:54321");
  });

  it("ignores non-ready stdout lines", () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const onUrlChange = vi.fn();

    new LoomSidecar({ bin: "/bin/loom", externalUrl: null, dbPath: "/x" }, onUrlChange).start();
    child.stdout.write("plain log line\n");
    expect(onUrlChange).not.toHaveBeenCalled();
  });

  it("retries once with backoff after an unexpected crash, then gives up", () => {
    vi.useFakeTimers();
    const firstChild = new FakeChild();
    const secondChild = new FakeChild();
    spawnMock.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
    const onUrlChange = vi.fn();

    new LoomSidecar({ bin: "/bin/loom", externalUrl: null, dbPath: "/x" }, onUrlChange).start();
    expect(spawnMock).toHaveBeenCalledTimes(1);

    firstChild.emit("exit", 1, null);
    expect(onUrlChange).toHaveBeenCalledWith(null);
    expect(spawnMock).toHaveBeenCalledTimes(1); // not yet — waiting on backoff

    vi.advanceTimersByTime(5_000);
    expect(spawnMock).toHaveBeenCalledTimes(2);

    secondChild.emit("exit", 1, null);
    vi.advanceTimersByTime(10_000);
    expect(spawnMock).toHaveBeenCalledTimes(2); // gave up quietly after one retry
  });

  it("stop() sends SIGTERM and suppresses the crash retry", () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const onUrlChange = vi.fn();

    const sidecar = new LoomSidecar(
      { bin: "/bin/loom", externalUrl: null, dbPath: "/x" },
      onUrlChange,
    );
    sidecar.start();
    sidecar.stop();

    expect(child.killed).toBe(true);
    child.emit("exit", 0, "SIGTERM");
    vi.advanceTimersByTime(10_000);
    expect(spawnMock).toHaveBeenCalledTimes(1); // no respawn once stopping
  });
});
