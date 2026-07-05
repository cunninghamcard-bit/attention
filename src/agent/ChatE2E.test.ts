// Full-stack e2e: the REAL chat stack (AgentTransport → Agent → ChatMessageList
// in jsdom) against a REAL spawned loom kernel running the mock harness.
// No transport mocks — only EventSource is polyfilled (jsdom lacks it), and the
// polyfill does real SSE parsing over a real fetch.
//
// Gated on LOOM_E2E_BIN: without it the whole suite is a no-op. Run for real:
//   go build -o /tmp/loom-e2e ./cmd/loom   (in the loom repo)
//   LOOM_E2E_BIN=/tmp/loom-e2e bunx vitest run src/agent/ChatE2E.test.ts
//
// ponytail: the root tsconfig has no `types` array, and nothing else under
// src/ touches Node builtins. `/// <reference types="node" />` would pull in
// @types/node's globals.d.ts too, which redeclares setTimeout/Buffer and
// breaks every other file's DOM-typed timers — so this references just the
// submodule .d.ts files it needs (their own `declare module "node:x"` blocks
// don't reference globals.d.ts) instead of widening the shared config.
/// <reference path="../../node_modules/@types/node/child_process.d.ts" />
/// <reference path="../../node_modules/@types/node/fs.d.ts" />
/// <reference path="../../node_modules/@types/node/os.d.ts" />
/// <reference path="../../node_modules/@types/node/path.d.ts" />
/// <reference path="../../node_modules/@types/node/process.d.ts" />
/// <reference path="../../node_modules/@types/node/buffer.d.ts" />
/// <reference path="../../node_modules/@types/node/events.d.ts" />
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nodeProcess from "node:process";
import type { Buffer as NodeBuffer } from "node:buffer";
import { Agent } from "./Agent";
import { AgentTransport } from "./AgentTransport";
import { ChatMessageList } from "./ChatMessageList";

// ProcessEnv's known-keys typing lives in @types/node's globals.d.ts, which
// also redeclares setTimeout/Buffer program-wide — cast instead of pulling
// that in just for one optional env var's type.
const BIN = (nodeProcess.env as Record<string, string | undefined>).LOOM_E2E_BIN;

// Minimal EventSource over fetch. The kernel sends only `data: {...}\n\n`
// frames (internal/api SSE handler), so no event:/id: handling is needed.
class FetchEventSource {
  onmessage: ((message: { data: string }) => void) | null = null;
  private readonly abort = new AbortController();

  constructor(url: string) {
    void this.pump(url);
  }

  private async pump(url: string): Promise<void> {
    try {
      const response = await fetch(url, { signal: this.abort.signal });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let cut: number;
        while ((cut = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          for (const line of frame.split("\n")) {
            if (line.startsWith("data: ")) this.onmessage?.({ data: line.slice(6) });
          }
        }
      }
    } catch {
      // close() aborts the fetch; a dropped kernel connection surfaces as a test timeout
    }
  }

  close(): void {
    this.abort.abort();
  }
}

async function waitFor(predicate: () => boolean, what: string, timeout = 10_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe.skipIf(!BIN)("chat e2e against a real loom kernel", () => {
  let kernel: ChildProcess;
  let baseUrl = "";
  const sessions: Agent[] = [];

  beforeAll(async () => {
    (globalThis as { EventSource?: unknown }).EventSource = FetchEventSource;
    const dir = mkdtempSync(join(tmpdir(), "loom-e2e-"));
    // -agents points at the empty tmpdir so the kernel never syncs ~/.loom/agents.
    kernel = spawn(BIN!, ["serve", "-port", "0", "-db", join(dir, "e2e.db"), "-agents", dir], {
      env: { ...nodeProcess.env, LOOM_DEFAULT_HARNESS: "mock" },
      stdio: ["ignore", "pipe", "inherit"],
    });
    baseUrl = await new Promise<string>((resolve, reject) => {
      let out = "";
      kernel.stdout!.on("data", (chunk: NodeBuffer) => {
        out += chunk.toString();
        if (!out.includes("\n")) return;
        // First stdout line is the machine-readable ready announcement.
        resolve((JSON.parse(out.split("\n")[0]) as { url: string }).url);
      });
      kernel.once("error", reject);
      kernel.once("exit", (code) => reject(new Error(`kernel exited before ready (code ${code})`)));
    });
  }, 30_000);

  afterAll(() => {
    for (const session of sessions) session.destroy();
    kernel?.kill("SIGTERM");
  });

  // The minimal ChatView wiring: transport-backed Agent, ChatMessageList in
  // the document, sync on every state change (scheduleSync minus the debounce).
  function mount(threadId: string) {
    const transport = new AgentTransport(baseUrl);
    const session = new Agent(threadId, transport);
    sessions.push(session);
    const parentEl = document.createElement("div");
    document.body.appendChild(parentEl);
    const list = new ChatMessageList(parentEl, session);
    list.load();
    session.on("changed", () => list.sync());
    session.connect();
    return { session, parentEl };
  }

  it("streams a real turn: user message, mock reply, tool timeline, usage", async () => {
    const { session, parentEl } = mount("e2e-tour");
    await session.sendMessage("你好,e2e");

    await waitFor(
      () => parentEl.querySelector('.chat-message[data-role="user"]')?.textContent?.includes("你好,e2e") === true,
      "user message in the DOM",
    );
    await waitFor(
      () => parentEl.querySelector('.chat-message[data-role="assistant"]')?.textContent?.includes("mock") === true,
      "mock assistant reply in the DOM",
    );
    // The mock harness runs one Bash tool per turn.
    await waitFor(() => parentEl.querySelector(".chat-tool-timeline") !== null, "tool timeline");

    // run.closed carries the mock's fixed usage into Agent state.
    await waitFor(() => session.state.usage !== null, "usage from run.closed");
    expect(session.state.usage).toMatchObject({ inputTokens: 900, outputTokens: 120, totalTokens: 1020 });
    expect(session.state.running).toBe(false);
  }, 15_000);

  it("permission round-trip: real Allow click resolves over HTTP and the turn completes", async () => {
    const { session, parentEl } = mount("e2e-perm");
    await session.sendMessage("请审批这次工具调用");

    await waitFor(
      () => parentEl.querySelector(".chat-permission:not(.is-resolved) .chat-permission-allow") !== null,
      "pending permission card",
    );
    (parentEl.querySelector(".chat-permission-allow") as HTMLElement).click();

    await waitFor(() => {
      const card = parentEl.querySelector(".chat-permission.is-resolved");
      return card?.textContent?.includes("allowed") === true;
    }, "resolved permission card");

    // run.closed lands: the approved tool ran to a result and the run stopped.
    await waitFor(() => !session.state.running && session.state.usage !== null, "run.closed after approval");
    const tool = session.state.messages.flatMap((message) => message.parts).find((part) => part?.type === "tool");
    expect(tool).toMatchObject({ toolName: "Bash", result: "loom", closed: true });
  }, 15_000);
});
