// Chat bridge: REST commands in, SSE canonical events out.
// The bridge owns threads, HTTP and user-message echoing; everything
// engine-specific lives behind the Engine interface (see engine.ts). It
// stands in for the future Go backend and speaks the same contract as
// src/agent/AgentEvent.ts.
//
//   bun server/chat-bridge.ts          Claude Code engine (requires `claude` auth)
//   bun server/chat-bridge.ts --pi     pi SDK engine (ANTHROPIC_API_KEY or PI_* env)
//   bun server/chat-bridge.ts --mock   scripted stream, no engine needed

import type { Engine } from "./engine";
import { claudeEngine } from "./claude-engine";
import { mockEngine } from "./mock-engine";
import { piEngine } from "./pi-engine";

const PORT = Number(process.env.CHAT_BRIDGE_PORT ?? 8787);

// Picked once at startup; per-agent engines arrive with the Go backend.
const engine: Engine = process.argv.includes("--mock")
  ? mockEngine
  : process.argv.includes("--pi")
    ? piEngine
    : claudeEngine;

interface BridgeEvent {
  seq: number;
  agentId: string;
  type: string;
  [key: string]: unknown;
}

interface AgentProfile {
  model?: string;
  effort?: string;
  temperature?: number;
  maxTokens?: number;
  params?: Record<string, string>;
}

interface Thread {
  id: string;
  seq: number;
  events: BridgeEvent[];
  listeners: Set<(event: BridgeEvent) => void>;
  counter: number;
  title: string | null;
  updatedAt: number;
  running: boolean;
  profile: AgentProfile;
}

const threads = new Map<string, Thread>();

function getThread(id: string): Thread {
  let thread = threads.get(id);
  if (!thread) {
    thread = {
      id,
      seq: 0,
      events: [],
      listeners: new Set(),
      counter: 0,
      title: null,
      updatedAt: Date.now(),
      running: false,
      profile: {},
    };
    threads.set(id, thread);
  }
  return thread;
}

function emit(thread: Thread, event: { type: string; ts?: number; [key: string]: unknown }): void {
  const full: BridgeEvent = { ts: Date.now(), ...event, seq: ++thread.seq, agentId: thread.id };
  thread.events.push(full);
  thread.updatedAt = Date.now();
  if (event.type === "run.started") thread.running = true;
  if (event.type === "run.closed") thread.running = false;
  for (const listener of thread.listeners) listener(full);
}

interface MessageAttachment {
  name: string;
  content: string;
}

function emitUserMessage(
  thread: Thread,
  text: string,
  attachments: MessageAttachment[] = [],
): void {
  if (!thread.title && text.trim()) {
    const line = text.trim().split("\n")[0];
    thread.title = line.length > 60 ? `${line.slice(0, 60)}…` : line;
  }
  const messageId = `${thread.id}-u${++thread.counter}`;
  emit(thread, { type: "message.started", messageId, role: "user" });
  emit(thread, { type: "part.opened", messageId, partIndex: 0, partType: "text" });
  emit(thread, { type: "part.delta", messageId, partIndex: 0, delta: text });
  emit(thread, { type: "part.closed", messageId, partIndex: 0 });
  attachments.forEach((attachment, index) => {
    const partIndex = index + 1;
    emit(thread, {
      type: "part.opened",
      messageId,
      partIndex,
      partType: "attachment",
      name: attachment.name,
    });
    emit(thread, { type: "part.delta", messageId, partIndex, delta: attachment.content });
    emit(thread, { type: "part.closed", messageId, partIndex });
  });
  emit(thread, { type: "message.closed", messageId });
}

function composePrompt(text: string, attachments: MessageAttachment[]): string {
  if (attachments.length === 0) return text;
  const blocks = attachments.map(
    (attachment) => `<attachment name="${attachment.name}">\n${attachment.content}\n</attachment>`,
  );
  return `${text}\n\n${blocks.join("\n\n")}`;
}

async function runEngine(
  thread: Thread,
  text: string,
  attachments: MessageAttachment[] = [],
): Promise<void> {
  const runId = `${thread.id}-r${++thread.counter}`;
  emit(thread, { type: "run.started", runId });
  emitUserMessage(thread, text, attachments);
  await engine.run({
    agentId: thread.id,
    runId,
    prompt: composePrompt(text, attachments),
    emit: (event) => emit(thread, event),
    profile: thread.profile,
  });
}

// --- HTTP -----------------------------------------------------------------

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

Bun.serve({
  port: PORT,
  idleTimeout: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

    if (url.pathname === "/models" && request.method === "GET") {
      return new Response(
        JSON.stringify({
          models: engine.listModels?.() ?? [],
          efforts: engine.listEfforts?.() ?? [],
        }),
        {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        },
      );
    }

    if (url.pathname === "/agents" && request.method === "GET") {
      const list = [...threads.values()]
        .filter((thread) => thread.events.length > 0)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((thread) => ({
          id: thread.id,
          title: thread.title,
          updatedAt: thread.updatedAt,
          running: thread.running,
          profile: thread.profile,
        }));
      return new Response(JSON.stringify({ agents: list }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // The native (Go) dialect: /streams with Go-marshaled capitalized
    // fields. The frontend speaks it now; this bridge answers both.
    if (url.pathname === "/streams" && request.method === "GET") {
      const list = [...threads.values()]
        .filter((thread) => thread.events.length > 0)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((thread) => ({
          ID: thread.id,
          Title: thread.title,
          UpdatedAt: thread.updatedAt,
          Running: thread.running,
        }));
      return new Response(JSON.stringify({ streams: list }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const eventsMatch = url.pathname.match(/^\/(?:agents|streams)\/([^/]+)\/events$/);
    if (eventsMatch && request.method === "GET") {
      const thread = getThread(decodeURIComponent(eventsMatch[1]));
      const since = Number(url.searchParams.get("since") ?? 0);
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const send = (event: BridgeEvent) =>
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          for (const event of thread.events) if (event.seq > since) send(event);
          const listener = (event: BridgeEvent) => send(event);
          thread.listeners.add(listener);
          const abort = () => thread.listeners.delete(listener);
          request.signal.addEventListener("abort", abort);
        },
      });
      return new Response(stream, {
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });
    }

    const messagesMatch = url.pathname.match(/^\/(?:agents|streams)\/([^/]+)\/messages$/);
    if (messagesMatch && request.method === "POST") {
      const thread = getThread(decodeURIComponent(messagesMatch[1]));
      const body = (await request.json().catch(() => ({}))) as {
        text?: string;
        attachments?: MessageAttachment[];
      };
      const text = String(body.text ?? "").trim();
      const attachments = Array.isArray(body.attachments)
        ? body.attachments
            .filter(
              (item) => item && typeof item.name === "string" && typeof item.content === "string",
            )
            .map((item) => ({ name: item.name, content: item.content }))
        : [];
      if (!text && attachments.length === 0)
        return new Response("missing text", { status: 400, headers: CORS_HEADERS });
      if (thread.running)
        return new Response("run in progress", { status: 409, headers: CORS_HEADERS });
      void runEngine(thread, text, attachments).catch((error) => {
        emit(thread, {
          type: "run.closed",
          runId: `${thread.id}-r${thread.counter}`,
          status: "error",
          error: String(error),
        });
      });
      return new Response("{}", {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const agentMatch = url.pathname.match(/^\/agents\/([^/]+)$/);
    if (agentMatch && request.method === "GET") {
      const thread = getThread(decodeURIComponent(agentMatch[1]));
      return new Response(
        JSON.stringify({
          id: thread.id,
          title: thread.title,
          updatedAt: thread.updatedAt,
          running: thread.running,
          profile: thread.profile,
        }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    if (agentMatch && request.method === "PATCH") {
      const thread = getThread(decodeURIComponent(agentMatch[1]));
      const body = (await request.json().catch(() => ({}))) as {
        title?: string;
        profile?: AgentProfile;
      };
      const title = String(body.title ?? "").trim();
      if (title) thread.title = title;
      // Shallow merge for known fields; params replace wholesale (the
      // editor always sends the full map).
      if (body.profile && typeof body.profile === "object") {
        if (body.profile.model !== undefined)
          thread.profile.model = body.profile.model || undefined;
        if (body.profile.effort !== undefined)
          thread.profile.effort = body.profile.effort || undefined;
        if (body.profile.temperature !== undefined)
          thread.profile.temperature =
            typeof body.profile.temperature === "number" ? body.profile.temperature : undefined;
        if (body.profile.maxTokens !== undefined)
          thread.profile.maxTokens =
            typeof body.profile.maxTokens === "number" ? body.profile.maxTokens : undefined;
        if (body.profile.params !== undefined) thread.profile.params = body.profile.params;
      }
      if (!title && !body.profile)
        return new Response("nothing to update", { status: 400, headers: CORS_HEADERS });
      return new Response("{}", {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    if (agentMatch && request.method === "DELETE") {
      const id = decodeURIComponent(agentMatch[1]);
      if (threads.has(id)) {
        engine.stop(id);
        threads.delete(id);
      }
      return new Response("{}", {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const stopMatch = url.pathname.match(/^\/(?:agents|streams)\/([^/]+)\/stop$/);
    if (stopMatch && request.method === "POST") {
      engine.stop(decodeURIComponent(stopMatch[1]));
      return new Response("{}", {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    return new Response("not found", { status: 404, headers: CORS_HEADERS });
  },
});

console.log(`chat-bridge listening on http://127.0.0.1:${PORT} (${engine.name} engine)`);
