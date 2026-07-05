// Full-stack e2e: the REAL chat stack against a REAL spawned loom
// kernel — no transport mocks. Gated on LOOM_E2E_BIN so the ordinary
// suite skips it; run with:
//   go build -o /tmp/loom-e2e <loom>/cmd/loom
//   LOOM_E2E_BIN=/tmp/loom-e2e bunx vitest run src/agent/ChatE2E.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";
import { Agent } from "./Agent";
import { AgentTransport } from "./AgentTransport";
import { ChatMessageList } from "./ChatMessageList";

const BIN = process.env.LOOM_E2E_BIN;

// jsdom has no EventSource; the transport needs one. Minimal SSE
// client over fetch — the kernel emits only `data: {...}` frames.
class FetchEventSource {
  onmessage: ((ev: { data: string }) => void) | null = null;
  private aborter = new AbortController();

  constructor(url: string) {
    void this.run(url);
  }

  private async run(url: string): Promise<void> {
    try {
      const resp = await fetch(url, { signal: this.aborter.signal });
      const reader = resp.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of frame.split("\n")) {
            if (line.startsWith("data: ")) this.onmessage?.({ data: line.slice(6) });
          }
        }
      }
    } catch {
      // aborted or connection dropped: e2e teardown, nothing to do
    }
  }

  close(): void {
    this.aborter.abort();
  }
}

async function waitFor(cond: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("condition not met in time");
}

describe.skipIf(!BIN)("chat e2e against a real kernel", () => {
  let kernel: ChildProcess;
  let baseUrl = "";

  beforeAll(async () => {
    (globalThis as { EventSource?: unknown }).EventSource = FetchEventSource;
    const db = join(mkdtempSync(join(tmpdir(), "chat-e2e-")), "e2e.db");
    kernel = spawn(BIN!, ["serve", "-port", "0", "-db", db], {
      env: { ...process.env, LOOM_DEFAULT_HARNESS: "mock" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    const line = await new Promise<string>((resolve, reject) => {
      const rl = readline.createInterface({ input: kernel.stdout! });
      rl.once("line", (l) => {
        rl.close();
        resolve(l);
      });
      kernel.once("exit", (code) => reject(new Error(`kernel exited early: ${code}`)));
      setTimeout(() => reject(new Error("kernel ready timeout")), 15_000);
    });
    const ready = JSON.parse(line) as { event: string; url: string };
    expect(ready.event).toBe("ready");
    baseUrl = ready.url;
  }, 30_000);

  afterAll(() => {
    kernel?.kill("SIGTERM");
  });

  it("streams a real turn end to end and settles a permission card", async () => {
    const transport = new AgentTransport(baseUrl);
    const session = new Agent("e2e-thread", transport);
    session.connect();
    const parentEl = document.createElement("div");
    document.body.appendChild(parentEl);
    const list = new ChatMessageList(parentEl, session);
    list.load();
    const rendered = (): string => {
      list.sync();
      return parentEl.textContent ?? "";
    };

    // 1. message → mock streamed reply + tool timeline
    await transport.sendMessage("e2e-thread", "你好,e2e 全栈");
    await waitFor(() => rendered().includes("mock 引擎在 loom 上应答"));
    expect(rendered()).toContain("你好,e2e 全栈");
    await waitFor(() => parentEl.querySelector(".chat-tool-timeline") !== null);

    // 2. permission round-trip: card appears, Allow resolves it live
    await transport.sendMessage("e2e-thread", "请审批:执行敏感操作");
    await waitFor(() => {
      list.sync();
      return parentEl.querySelector(".chat-permission:not(.is-resolved)") !== null;
    });
    const allow = parentEl.querySelector<HTMLElement>(".chat-permission-allow");
    expect(allow).not.toBeNull();
    allow!.click();
    await waitFor(() => {
      list.sync();
      const resolved = parentEl.querySelector(".chat-permission.is-resolved");
      return resolved !== null && (resolved.textContent ?? "").includes("allowed");
    });

    // 3. the turn settled: not running, seq advanced
    await waitFor(() => !session.state.running);
    expect(session.state.lastSeq).toBeGreaterThan(0);
    session.disconnect?.();
  }, 30_000);
});
