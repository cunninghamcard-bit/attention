/**
 * Input: None
 * Output: test suite
 * Pos: Test code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTerminalAdapter, TerminalSpawnError } from "@web/builtin/terminal/TerminalAdapter";
import { RemoteTerminalAdapter } from "@web/builtin/terminal/RemoteTerminalAdapter";

/**
 * The PTY over a socket, sitting at the adapter seam. The protocol is restty's
 * and stays restty's — these tests drive the transport it hands us, so what is
 * under test is the handle wrapped around it: the queue that lets `spawn()`
 * answer synchronously while the socket is still opening, and the single exit.
 */

interface Callbacks {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onData?: (data: string) => void;
  onExit?: (code: number) => void;
  onError?: (message: string, errors?: string[]) => void;
}

let connectArgs: { url: string; cols?: number; rows?: number } | null = null;
let callbacks: Callbacks = {};
let connectThrows: string | null = null;
const sendInput = vi.fn((_data: string) => true);
const resize = vi.fn((_cols: number, _rows: number) => true);
const disconnect = vi.fn();
const destroy = vi.fn();

/** Stands in for restty's own `createWebSocketPtyTransport`. */
const loadTransport = async () => ({
  connect(options: { url: string; cols?: number; rows?: number; callbacks: Callbacks }) {
    if (connectThrows) throw new Error(connectThrows);
    connectArgs = { url: options.url, cols: options.cols, rows: options.rows };
    callbacks = options.callbacks;
  },
  disconnect,
  sendInput,
  resize,
  destroy,
});

/** Past the awaited loader inside spawn(). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  connectArgs = null;
  callbacks = {};
  connectThrows = null;
  vi.clearAllMocks();
  delete (globalThis as { electronTerminal?: unknown }).electronTerminal;
});

describe("RemoteTerminalAdapter", () => {
  it("wins over the local bridge once a server URL is configured", () => {
    (globalThis as { electronTerminal?: unknown }).electronTerminal = {
      available: true,
      defaultShell: "/bin/zsh",
      homeDir: "/home",
      spawn: () => ({}),
    };

    expect(createTerminalAdapter("ws://localhost:8787/pty")).toBeInstanceOf(RemoteTerminalAdapter);
    // Empty is the default and leaves the desktop bridge in place.
    expect(createTerminalAdapter("")).not.toBeInstanceOf(RemoteTerminalAdapter);
    expect(createTerminalAdapter("   ")).not.toBeInstanceOf(RemoteTerminalAdapter);
  });

  it("refuses to spawn against an empty URL instead of opening a socket to nowhere", () => {
    expect(() => new RemoteTerminalAdapter("  ", loadTransport).spawn({})).toThrow(
      TerminalSpawnError,
    );
  });

  it("answers with a live handle while the socket is still opening, then drains the queue", async () => {
    const handle = new RemoteTerminalAdapter("ws://host/pty", loadTransport).spawn({
      cols: 80,
      rows: 24,
    });

    // Typed before restty has even been imported.
    handle.write("first");
    handle.resize(100, 40);
    handle.write("second");
    expect(sendInput).not.toHaveBeenCalled();

    await settle();
    expect(connectArgs).toEqual({ url: "ws://host/pty", cols: 80, rows: 24 });
    expect(sendInput).not.toHaveBeenCalled();

    callbacks.onConnect?.();
    // The resize goes first — the shell should learn its size before it reads
    // the input that was typed at it — and only the latest one is replayed.
    expect(resize).toHaveBeenCalledTimes(1);
    expect(resize).toHaveBeenCalledWith(100, 40);
    expect(sendInput.mock.calls.map((call) => call[0])).toEqual(["first", "second"]);

    // Past the queue, writes go straight through.
    handle.write("third");
    expect(sendInput).toHaveBeenLastCalledWith("third");
  });

  it("delivers server output and exits exactly once", async () => {
    const handle = new RemoteTerminalAdapter("ws://host/pty", loadTransport).spawn({});
    const data: string[] = [];
    const exits: number[] = [];
    handle.onData((chunk) => data.push(chunk));
    handle.onExit((code) => exits.push(code));
    await settle();

    callbacks.onConnect?.();
    callbacks.onData?.("hello");
    expect(data).toEqual(["hello"]);

    // A server that reports the code and then drops the socket must not fire
    // the exit twice.
    callbacks.onExit?.(3);
    callbacks.onDisconnect?.();
    expect(exits).toEqual([3]);
  });

  it("says why the connection failed rather than going quiet", async () => {
    connectThrows = "ECONNREFUSED";
    const handle = new RemoteTerminalAdapter("ws://host/pty", loadTransport).spawn({});
    const data: string[] = [];
    const exits: number[] = [];
    handle.onData((chunk) => data.push(chunk));
    handle.onExit((code) => exits.push(code));

    await settle();

    expect(data.join("")).toContain("ECONNREFUSED");
    expect(exits).toEqual([1]);
  });

  it("kills before the import lands without opening a socket behind it", async () => {
    const handle = new RemoteTerminalAdapter("ws://host/pty", loadTransport).spawn({});
    handle.kill();

    await settle();

    expect(connectArgs).toBeNull();
    expect(disconnect).not.toHaveBeenCalled();
  });
});
