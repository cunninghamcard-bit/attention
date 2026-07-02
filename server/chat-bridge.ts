// Chat bridge: REST commands in, SSE canonical events out.
// Drives Claude Code (`claude -p --output-format stream-json`) as the agent
// engine. Stands in for the future Go backend and speaks the same contract
// as src/chat/ChatEvent.ts.
//
//   bun server/chat-bridge.ts          real engine (requires `claude` auth)
//   bun server/chat-bridge.ts --mock   scripted stream, no engine needed

const PORT = Number(process.env.CHAT_BRIDGE_PORT ?? 8787);
const MOCK = process.argv.includes("--mock");
const EXTRA_CLAUDE_ARGS = (process.env.CHAT_BRIDGE_CLAUDE_ARGS ?? "").split(" ").filter(Boolean);

interface BridgeEvent {
  seq: number;
  threadId: string;
  type: string;
  [key: string]: unknown;
}

interface Thread {
  id: string;
  seq: number;
  events: BridgeEvent[];
  listeners: Set<(event: BridgeEvent) => void>;
  engineSessionId: string | null;
  proc: ReturnType<typeof Bun.spawn> | null;
  counter: number;
  title: string | null;
  updatedAt: number;
  running: boolean;
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
      engineSessionId: null,
      proc: null,
      counter: 0,
      title: null,
      updatedAt: Date.now(),
      running: false,
    };
    threads.set(id, thread);
  }
  return thread;
}

function emit(thread: Thread, event: Omit<BridgeEvent, "seq" | "threadId">): void {
  const full: BridgeEvent = { ...event, seq: ++thread.seq, threadId: thread.id };
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

function emitUserMessage(thread: Thread, text: string, attachments: MessageAttachment[] = []): void {
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
    emit(thread, { type: "part.opened", messageId, partIndex, partType: "attachment", name: attachment.name });
    emit(thread, { type: "part.delta", messageId, partIndex, delta: attachment.content });
    emit(thread, { type: "part.closed", messageId, partIndex });
  });
  emit(thread, { type: "message.closed", messageId });
}

function composePrompt(text: string, attachments: MessageAttachment[]): string {
  if (attachments.length === 0) return text;
  const blocks = attachments.map((attachment) => `<attachment name="${attachment.name}">\n${attachment.content}\n</attachment>`);
  return `${text}\n\n${blocks.join("\n\n")}`;
}

// --- Claude Code stream-json -> canonical events -------------------------

interface EngineRunState {
  runId: string;
  currentMessageId: string | null;
  toolParts: Map<string, { messageId: string; partIndex: number }>;
  openParts: Map<number, { partType: string; toolId?: string }>;
}

function handleEngineLine(thread: Thread, run: EngineRunState, line: string): void {
  let payload: any;
  try {
    payload = JSON.parse(line);
  } catch {
    return;
  }

  if (payload.type === "system" && payload.subtype === "init") {
    thread.engineSessionId = payload.session_id ?? thread.engineSessionId;
    return;
  }

  if (payload.type === "stream_event") {
    const event = payload.event;
    if (!event) return;
    switch (event.type) {
      case "message_start": {
        run.currentMessageId = event.message?.id ?? `${thread.id}-a${++thread.counter}`;
        run.openParts.clear();
        emit(thread, { type: "message.started", messageId: run.currentMessageId, role: "assistant" });
        return;
      }
      case "content_block_start": {
        if (!run.currentMessageId) return;
        const block = event.content_block ?? {};
        const partType = block.type === "tool_use" ? "tool" : block.type === "thinking" ? "thinking" : "text";
        run.openParts.set(event.index, { partType, toolId: block.id });
        if (partType === "tool" && block.id) {
          run.toolParts.set(block.id, { messageId: run.currentMessageId, partIndex: event.index });
        }
        emit(thread, {
          type: "part.opened",
          messageId: run.currentMessageId,
          partIndex: event.index,
          partType,
          toolName: block.name,
        });
        return;
      }
      case "content_block_delta": {
        if (!run.currentMessageId) return;
        const delta = event.delta ?? {};
        const text = delta.text ?? delta.thinking ?? delta.partial_json ?? "";
        if (!text) return;
        emit(thread, { type: "part.delta", messageId: run.currentMessageId, partIndex: event.index, delta: text });
        return;
      }
      case "content_block_stop": {
        if (!run.currentMessageId) return;
        emit(thread, { type: "part.closed", messageId: run.currentMessageId, partIndex: event.index });
        return;
      }
      case "message_stop": {
        if (!run.currentMessageId) return;
        emit(thread, { type: "message.closed", messageId: run.currentMessageId });
        run.currentMessageId = null;
        return;
      }
    }
    return;
  }

  // Tool results come back as user-role messages carrying tool_result blocks.
  if (payload.type === "user") {
    const content = payload.message?.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (block?.type !== "tool_result") continue;
      const target = run.toolParts.get(block.tool_use_id);
      if (!target) continue;
      const result =
        typeof block.content === "string"
          ? block.content
          : Array.isArray(block.content)
            ? block.content.map((item: any) => item?.text ?? "").join("\n")
            : JSON.stringify(block.content ?? "");
      emit(thread, { type: "part.closed", messageId: target.messageId, partIndex: target.partIndex, result });
    }
  }
}

async function runEngine(thread: Thread, text: string, attachments: MessageAttachment[] = []): Promise<void> {
  const runId = `${thread.id}-r${++thread.counter}`;
  emit(thread, { type: "run.started", runId });
  emitUserMessage(thread, text, attachments);

  if (MOCK) {
    await runMockEngine(thread, runId, text);
    return;
  }

  const prompt = composePrompt(text, attachments);
  const args = ["claude", "-p", prompt, "--output-format", "stream-json", "--include-partial-messages", "--verbose"];
  if (thread.engineSessionId) args.push("--resume", thread.engineSessionId);
  args.push(...EXTRA_CLAUDE_ARGS);

  // The desktop host injects a proxy base URL that child processes cannot
  // authenticate against; strip it so the CLI uses its own credentials.
  const env = { ...process.env };
  delete env.ANTHROPIC_BASE_URL;
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_CODE_CHILD_SESSION;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  const proc = Bun.spawn(args, { env, stdout: "pipe", stderr: "pipe" });
  thread.proc = proc;
  const run: EngineRunState = { runId, currentMessageId: null, toolParts: new Map(), openParts: new Map() };

  let buffered = "";
  let sawError: string | null = null;
  const decoder = new TextDecoder();
  for await (const chunk of proc.stdout) {
    buffered += decoder.decode(chunk, { stream: true });
    let newline = buffered.indexOf("\n");
    while (newline !== -1) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (line) {
        handleEngineLine(thread, run, line);
        try {
          const payload = JSON.parse(line);
          if (payload.type === "result" && payload.is_error) sawError = payload.result ?? "engine error";
        } catch {
          // non-JSON lines are ignored
        }
      }
      newline = buffered.indexOf("\n");
    }
  }
  const exitCode = await proc.exited;
  thread.proc = null;
  if (run.currentMessageId) emit(thread, { type: "message.closed", messageId: run.currentMessageId });
  if (sawError) emit(thread, { type: "run.closed", runId, status: "error", error: sawError });
  else if (exitCode !== 0) emit(thread, { type: "run.closed", runId, status: "error", error: `engine exited with ${exitCode}` });
  else emit(thread, { type: "run.closed", runId, status: "completed" });
}

// --- Mock engine ----------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runMockEngine(thread: Thread, runId: string, text: string): Promise<void> {
  const messageId = `${thread.id}-a${++thread.counter}`;
  emit(thread, { type: "message.started", messageId, role: "assistant" });

  emit(thread, { type: "part.opened", messageId, partIndex: 0, partType: "text" });
  const intro = `你发来了:**${text.slice(0, 40)}**\n\n下面演示流式渲染,详见 [[Welcome]]:\n\n## 一个标题\n\n| 特性 | 状态 |\n| --- | --- |\n| 表格流式 | ✅ |\n| 内链元素 | ✅ |\n\n\`\`\`ts\nconst answer = 42;\nconsole.log(answer);\n\`\`\`\n\n\`\`\`mermaid\ngraph LR\n  A[SSE] --> B[reducer] --> C[ChatView]\n\`\`\`\n\n`;
  for (const chunk of intro.match(/.{1,7}/gs) ?? []) {
    emit(thread, { type: "part.delta", messageId, partIndex: 0, delta: chunk });
    await sleep(24);
  }
  emit(thread, { type: "part.closed", messageId, partIndex: 0 });

  emit(thread, { type: "part.opened", messageId, partIndex: 1, partType: "tool", toolName: "Bash" });
  emit(thread, { type: "part.delta", messageId, partIndex: 1, delta: '{"command":"echo hello"}' });
  emit(thread, { type: "part.closed", messageId, partIndex: 1 });
  await sleep(400);
  emit(thread, { type: "part.closed", messageId, partIndex: 1, result: "hello" });

  emit(thread, { type: "part.opened", messageId, partIndex: 2, partType: "text" });
  const outro = "工具跑完了。*流式*结束,这一条消息现在归档,DOM 原地移交。";
  for (const chunk of outro.match(/.{1,5}/gs) ?? []) {
    emit(thread, { type: "part.delta", messageId, partIndex: 2, delta: chunk });
    await sleep(30);
  }
  emit(thread, { type: "part.closed", messageId, partIndex: 2 });
  emit(thread, { type: "message.closed", messageId });
  emit(thread, { type: "run.closed", runId, status: "completed" });
}

// --- HTTP -----------------------------------------------------------------

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

Bun.serve({
  port: PORT,
  idleTimeout: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

    if (url.pathname === "/threads" && request.method === "GET") {
      const list = [...threads.values()]
        .filter((thread) => thread.events.length > 0)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((thread) => ({ id: thread.id, title: thread.title, updatedAt: thread.updatedAt, running: thread.running }));
      return new Response(JSON.stringify({ threads: list }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const eventsMatch = url.pathname.match(/^\/threads\/([^/]+)\/events$/);
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
        headers: { ...CORS_HEADERS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    }

    const messagesMatch = url.pathname.match(/^\/threads\/([^/]+)\/messages$/);
    if (messagesMatch && request.method === "POST") {
      const thread = getThread(decodeURIComponent(messagesMatch[1]));
      const body = (await request.json().catch(() => ({}))) as { text?: string; attachments?: MessageAttachment[] };
      const text = String(body.text ?? "").trim();
      const attachments = Array.isArray(body.attachments)
        ? body.attachments
            .filter((item) => item && typeof item.name === "string" && typeof item.content === "string")
            .map((item) => ({ name: item.name, content: item.content }))
        : [];
      if (!text && attachments.length === 0) return new Response("missing text", { status: 400, headers: CORS_HEADERS });
      if (thread.proc) return new Response("run in progress", { status: 409, headers: CORS_HEADERS });
      void runEngine(thread, text, attachments).catch((error) => {
        emit(thread, { type: "run.closed", runId: `${thread.id}-r${thread.counter}`, status: "error", error: String(error) });
      });
      return new Response("{}", { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    const stopMatch = url.pathname.match(/^\/threads\/([^/]+)\/stop$/);
    if (stopMatch && request.method === "POST") {
      const thread = getThread(decodeURIComponent(stopMatch[1]));
      thread.proc?.kill();
      return new Response("{}", { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    return new Response("not found", { status: 404, headers: CORS_HEADERS });
  },
});

console.log(`chat-bridge listening on http://127.0.0.1:${PORT}${MOCK ? " (mock engine)" : ""}`);
