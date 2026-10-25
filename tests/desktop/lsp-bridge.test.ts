/**
 * Input: node:fs, node:os, node:path, apps/desktop/preload/lsp-bridge
 * Output: test suite
 * Pos: Test code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  LspFrameDecoder,
  createElectronLspApi,
  encodeLspFrame,
  lspSearchDirs,
  resolveLspBinary,
} from "../../apps/desktop/preload/lsp-bridge";

describe("LSP framing", () => {
  it("counts the body in bytes, not characters", () => {
    const frame = encodeLspFrame('{"text":"定义"}');
    // Two CJK characters are six UTF-8 bytes; a character count would cut the
    // message short on the server side.
    expect(frame.toString("utf8")).toBe('Content-Length: 17\r\n\r\n{"text":"定义"}');
  });

  it("reassembles a message split across chunks, even mid-character", () => {
    const decoder = new LspFrameDecoder();
    const frame = encodeLspFrame('{"text":"定义"}');
    const out: string[] = [];
    // Byte by byte: every split point, including inside the header and inside
    // a multi-byte character, must still produce exactly one message.
    for (const byte of frame) out.push(...decoder.push(Buffer.from([byte])));
    expect(out).toEqual(['{"text":"定义"}']);
  });

  it("splits several messages that arrive in one chunk", () => {
    const decoder = new LspFrameDecoder();
    const chunk = Buffer.concat([encodeLspFrame('{"id":1}'), encodeLspFrame('{"id":2}')]);
    expect(decoder.push(chunk)).toEqual(['{"id":1}', '{"id":2}']);
  });

  it("accepts extra headers and any header case", () => {
    const decoder = new LspFrameDecoder();
    const body = '{"ok":true}';
    const raw = `content-length: ${body.length}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n${body}`;
    expect(decoder.push(Buffer.from(raw))).toEqual([body]);
  });

  it("skips output that is not a frame and keeps going", () => {
    const decoder = new LspFrameDecoder();
    const noise = Buffer.from("Starting server...\r\n\r\n");
    expect(decoder.push(Buffer.concat([noise, encodeLspFrame('{"id":1}')]))).toEqual(['{"id":1}']);
  });
});

describe("finding a server binary", () => {
  it("takes the first directory that has the command", () => {
    const has = new Set(["/b/ty", "/c/ty"]);
    expect(resolveLspBinary("ty", ["/a", "/b", "/c"], (path) => has.has(path), "linux")).toBe(
      "/b/ty",
    );
    expect(resolveLspBinary("gopls", ["/a", "/b"], (path) => has.has(path), "linux")).toBeNull();
  });

  it("checks an absolute path as given", () => {
    expect(resolveLspBinary("/opt/ty", [], (path) => path === "/opt/ty", "linux")).toBe("/opt/ty");
    expect(resolveLspBinary("/opt/ty", ["/opt"], () => false, "linux")).toBeNull();
  });

  it("never returns a relative path", () => {
    // PATH can hold relative entries (`node_modules/.bin`). The server is
    // spawned with the PROJECT as cwd, so a relative result would point at a
    // different file — or none.
    const found = resolveLspBinary("tsc", ["node_modules/.bin"], () => true, "linux");
    expect(found).toBe(join(process.cwd(), "node_modules/.bin/tsc"));
  });

  it("tries Windows executable suffixes", () => {
    const found = resolveLspBinary("ty", ["C:\\tools"], (path) => path.endsWith("ty.exe"), "win32");
    expect(found?.endsWith("ty.exe")).toBe(true);
  });

  it("searches PATH first, then the usual install spots", () => {
    const dirs = lspSearchDirs({ PATH: "/usr/bin:/custom/bin" }, "/home/me", "linux");
    expect(dirs.slice(0, 2)).toEqual(["/usr/bin", "/custom/bin"]);
    // A GUI app inherits a bare PATH; per-user tool directories are added.
    expect(dirs).toContain("/home/me/.local/bin");
    expect(dirs).toContain("/home/me/.cargo/bin");
    expect(dirs).toContain("/opt/homebrew/bin");
    expect(dirs.filter((dir) => dir === "/usr/bin")).toHaveLength(1);
  });
});

// A real child process: a tiny server that speaks the base protocol.
const dir = mkdtempSync(join(tmpdir(), "lsp-bridge-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const echoServer = join(dir, "echo-server.cjs");
writeFileSync(
  echoServer,
  `
let buffer = Buffer.alloc(0);
const send = (obj) => { const s = JSON.stringify(obj); process.stdout.write("Content-Length: " + Buffer.byteLength(s) + "\\r\\n\\r\\n" + s); };
process.stderr.write("booting\\n");
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf("\\r\\n\\r\\n"); if (end < 0) return;
    const length = Number(/Content-Length: (\\d+)/i.exec(buffer.subarray(0, end).toString())[1]);
    if (buffer.length < end + 4 + length) return;
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString("utf8"));
    buffer = buffer.subarray(end + 4 + length);
    if (message.method === "exit") process.exit(7);
    send({ id: message.id, result: { echo: message.params, cwd: process.cwd(), path: process.env.PATH } });
  }
});
`,
);
chmodSync(echoServer, 0o755);

describe("createElectronLspApi", () => {
  it("round-trips messages with a real process, in the project directory", async () => {
    const api = createElectronLspApi();
    const handle = api.spawn({ command: process.execPath, args: [echoServer], cwd: dir });
    const messages: string[] = [];
    let stderr = "";
    handle.onStderr((text) => (stderr += text));
    const first = new Promise<void>((resolve) =>
      handle.onMessage((message) => {
        messages.push(message);
        resolve();
      }),
    );
    handle.send(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { text: "定义" } }),
    );
    await first;

    const reply = JSON.parse(messages[0]!) as {
      id: number;
      result: { echo: unknown; cwd: string; path: string };
    };
    expect(reply.id).toBe(1);
    expect(reply.result.echo).toEqual({ text: "定义" });
    expect(reply.result.cwd.endsWith(dir.split("/").pop()!)).toBe(true);
    // The child gets the widened PATH, so a script server finds its interpreter.
    expect(reply.result.path).toContain("/usr/local/bin");
    expect(stderr).toContain("booting");
    expect(handle.pid).toBeGreaterThan(0);

    const exited = new Promise<number | null>((resolve) => handle.onExit(resolve));
    handle.send(JSON.stringify({ jsonrpc: "2.0", method: "exit" }));
    expect(await exited).toBe(7);
    expect(() => handle.send("{}")).toThrow(/not running/);
  });

  it("kills a running server", async () => {
    const api = createElectronLspApi();
    const handle = api.spawn({ command: process.execPath, args: [echoServer], cwd: dir });
    const exited = new Promise<number | null>((resolve) => handle.onExit(resolve));
    handle.kill();
    expect(await exited).toBeNull();
  });

  it("reports a command that cannot be started as an exit, not a throw", async () => {
    const api = createElectronLspApi();
    const handle = api.spawn({ command: join(dir, "no-such-server"), args: [], cwd: dir });
    let stderr = "";
    handle.onStderr((text) => (stderr += text));
    const code = await new Promise<number | null>((resolve) => handle.onExit(resolve));
    expect(code).toBeNull();
    expect(stderr).toMatch(/ENOENT/);
  });

  it("resolves through PATH and extra directories", () => {
    const api = createElectronLspApi(undefined, { PATH: "/nonexistent" });
    expect(api.resolve("echo-server.cjs")).toBeNull();
    expect(api.resolve("echo-server.cjs", [dir])).toBe(echoServer);
  });
});
