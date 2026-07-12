// Claude Code engine: drives `claude -p --output-format stream-json` and
// maps stream-json lines to canonical events. Owns its own per-agent state
// (engine session id for --resume, live proc for stop) — the bridge knows
// none of it.
import type { Engine, EngineEmit } from "./engine";

const EXTRA_CLAUDE_ARGS = (process.env.CHAT_BRIDGE_CLAUDE_ARGS ?? "").split(" ").filter(Boolean);

interface ClaudeAgentState {
  sessionId: string | null;
  proc: ReturnType<typeof Bun.spawn> | null;
  counter: number;
}

const agents = new Map<string, ClaudeAgentState>();

function getAgent(agentId: string): ClaudeAgentState {
  let state = agents.get(agentId);
  if (!state) {
    state = { sessionId: null, proc: null, counter: 0 };
    agents.set(agentId, state);
  }
  return state;
}

interface RunState {
  currentMessageId: string | null;
  toolParts: Map<string, { messageId: string; partIndex: number }>;
  openParts: Map<number, { partType: string; toolId?: string }>;
}

function handleLine(
  agentId: string,
  state: ClaudeAgentState,
  run: RunState,
  line: string,
  emit: EngineEmit,
): void {
  let payload: any;
  try {
    payload = JSON.parse(line);
  } catch {
    return;
  }

  if (payload.type === "system" && payload.subtype === "init") {
    state.sessionId = payload.session_id ?? state.sessionId;
    return;
  }

  if (payload.type === "system" && payload.subtype === "compact_boundary") {
    emit({
      type: "context.compacted",
      preTokens: payload.compact_metadata?.pre_tokens,
      trigger: payload.compact_metadata?.trigger,
    });
    return;
  }

  if (payload.type === "stream_event") {
    const event = payload.event;
    if (!event) return;
    switch (event.type) {
      case "message_start": {
        run.currentMessageId = event.message?.id ?? `${agentId}-a${++state.counter}`;
        run.openParts.clear();
        emit({ type: "message.started", messageId: run.currentMessageId, role: "assistant" });
        return;
      }
      case "content_block_start": {
        if (!run.currentMessageId) return;
        const block = event.content_block ?? {};
        const partType =
          block.type === "tool_use" ? "tool" : block.type === "thinking" ? "thinking" : "text";
        run.openParts.set(event.index, { partType, toolId: block.id });
        if (partType === "tool" && block.id) {
          run.toolParts.set(block.id, { messageId: run.currentMessageId, partIndex: event.index });
        }
        emit({
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
        emit({
          type: "part.delta",
          messageId: run.currentMessageId,
          partIndex: event.index,
          delta: text,
        });
        return;
      }
      case "content_block_stop": {
        if (!run.currentMessageId) return;
        emit({ type: "part.closed", messageId: run.currentMessageId, partIndex: event.index });
        return;
      }
      case "message_stop": {
        if (!run.currentMessageId) return;
        emit({ type: "message.closed", messageId: run.currentMessageId });
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
      emit({
        type: "part.closed",
        messageId: target.messageId,
        partIndex: target.partIndex,
        result,
        ...(block.is_error ? { error: result || "tool failed" } : {}),
      });
    }
  }
}

export const claudeEngine: Engine = {
  name: "claude",

  async run({ agentId, runId, prompt, emit }) {
    const state = getAgent(agentId);
    const args = [
      "claude",
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
    ];
    if (state.sessionId) args.push("--resume", state.sessionId);
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
    state.proc = proc;
    const run: RunState = { currentMessageId: null, toolParts: new Map(), openParts: new Map() };

    let buffered = "";
    let sawError: string | null = null;
    let usage: Record<string, unknown> | undefined;
    const decoder = new TextDecoder();
    for await (const chunk of proc.stdout) {
      buffered += decoder.decode(chunk, { stream: true });
      let newline = buffered.indexOf("\n");
      while (newline !== -1) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (line) {
          handleLine(agentId, state, run, line, emit);
          try {
            const payload = JSON.parse(line);
            if (payload.type === "result") {
              if (payload.is_error) sawError = payload.result ?? "engine error";
              const raw = payload.usage;
              if (raw) {
                const inputTokens =
                  (raw.input_tokens ?? 0) +
                  (raw.cache_read_input_tokens ?? 0) +
                  (raw.cache_creation_input_tokens ?? 0);
                usage = {
                  inputTokens,
                  outputTokens: raw.output_tokens ?? 0,
                  totalTokens: inputTokens + (raw.output_tokens ?? 0),
                  ...(payload.total_cost_usd !== undefined
                    ? { costUsd: payload.total_cost_usd }
                    : {}),
                };
              }
            }
          } catch {
            // non-JSON lines are ignored
          }
        }
        newline = buffered.indexOf("\n");
      }
    }
    const exitCode = await proc.exited;
    state.proc = null;
    if (run.currentMessageId) emit({ type: "message.closed", messageId: run.currentMessageId });
    if (sawError) emit({ type: "run.closed", runId, status: "error", error: sawError, usage });
    else if (exitCode !== 0)
      emit({
        type: "run.closed",
        runId,
        status: "error",
        error: `engine exited with ${exitCode}`,
        usage,
      });
    else emit({ type: "run.closed", runId, status: "completed", usage });
  },

  stop(agentId) {
    agents.get(agentId)?.proc?.kill();
  },
};
