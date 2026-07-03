// Pi engine adapter: one persistent AgentSession per agent, pi events mapped
// to our canonical events. This is the faithful prototype of the along-go
// Worker — pi is what along-go reimplements in Go, so mapping here is close
// to identity and the along-go port inherits it.
import { AuthStorage, ModelRegistry, createAgentSession, type AgentSession } from "@earendil-works/pi-coding-agent";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Engine, EngineEmit } from "./engine";

type CanonicalEmit = EngineEmit;

// Engine config from env. PI_BASE_URL points at an Anthropic-compatible
// endpoint (e.g. https://api.deepseek.com/anthropic) served under a custom
// provider; unset uses pi's built-in anthropic provider + ANTHROPIC_API_KEY.
const PROVIDER = process.env.PI_BASE_URL ? "custom" : "anthropic";
const MODEL_ID = process.env.PI_MODEL ?? (process.env.PI_BASE_URL ? "deepseek-chat" : "claude-sonnet-4-5");

let registry: { modelRegistry: ModelRegistry; authStorage: AuthStorage } | null = null;

function getRegistry(): { modelRegistry: ModelRegistry; authStorage: AuthStorage } {
  if (registry) return registry;
  if (process.env.PI_BASE_URL) {
    // Custom Anthropic-compatible provider; key stays a runtime override
    // (never written to disk), the temp models.json holds only the shape.
    const dir = mkdtempSync(join(tmpdir(), "pi-engine-"));
    const modelsPath = join(dir, "models.json");
    writeFileSync(
      modelsPath,
      JSON.stringify({ providers: { custom: { baseUrl: process.env.PI_BASE_URL, api: "anthropic-messages", models: [{ id: MODEL_ID }] } } }),
    );
    const authStorage = AuthStorage.create(join(dir, "auth.json"));
    if (process.env.PI_API_KEY) authStorage.setRuntimeApiKey("custom", process.env.PI_API_KEY);
    registry = { modelRegistry: ModelRegistry.create(authStorage, modelsPath), authStorage };
  } else {
    const authStorage = AuthStorage.create();
    registry = { modelRegistry: ModelRegistry.create(authStorage), authStorage };
  }
  return registry;
}

interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  // Last assistant turn's total = current context occupancy; the summed
  // totals above double-count re-sent context.
  contextTokens?: number;
  contextWindow?: number;
}

interface SessionEntry {
  session: AgentSession;
  counter: number;
  bridged?: boolean;
  contextWindow?: number;
  // Accumulated by the event bridge across the run's assistant messages,
  // drained by runPiEngine into run.closed.
  usage: RunUsage;
}

const sessions = new Map<string, SessionEntry>();

const zeroUsage = (): RunUsage => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 });

async function ensureSession(agentId: string): Promise<AgentSession> {
  const existing = sessions.get(agentId);
  if (existing) return existing.session;

  const { modelRegistry, authStorage } = getRegistry();
  const model = modelRegistry.find(PROVIDER, MODEL_ID);
  if (!model) throw new Error(`Unknown model ${PROVIDER}/${MODEL_ID}`);

  // Sandbox each agent's working dir: this dev bridge drives a real coding
  // agent with bash/edit/write, so keep it out of the repo. PI_CWD overrides.
  const cwd = process.env.PI_CWD ?? mkdtempSync(join(tmpdir(), `agent-${agentId}-`));
  const { session } = await createAgentSession({ model, modelRegistry, authStorage, cwd });
  sessions.set(agentId, { session, counter: 0, usage: zeroUsage(), contextWindow: (model as { contextWindow?: number }).contextWindow });
  return session;
}

// Pi emits structured events already; the transform is mostly a rename plus
// splitting assistant-message deltas into our text/thinking/tool parts.
// message.started is emitted lazily on the first real part, so pi's empty
// turn-boundary messages produce no canonical noise. Verified end to end
// against DeepSeek's Anthropic-compatible endpoint.
function bridgeEvents(agentId: string, session: AgentSession, emit: CanonicalEmit): void {
  const nextMessageId = () => `${agentId}-a${(sessions.get(agentId)!.counter += 1)}`;
  let currentMessageId: string | null = null;
  let messageStarted = false;
  // pi content index -> our part index + type; tool calls carry their id.
  const openParts = new Map<number, { partIndex: number; type: string }>();
  const toolParts = new Map<string, { partIndex: number; messageId: string }>();
  let nextPartIndex = 0;

  const ensureStarted = (): string => {
    if (!currentMessageId) currentMessageId = nextMessageId();
    if (!messageStarted) {
      messageStarted = true;
      emit({ type: "message.started", messageId: currentMessageId, role: "assistant" });
    }
    return currentMessageId;
  };

  session.subscribe((event) => {
    switch (event.type) {
      case "message_start": {
        currentMessageId = null;
        messageStarted = false;
        openParts.clear();
        nextPartIndex = 0;
        return;
      }
      case "message_update": {
        const inner = (event as { assistantMessageEvent?: { type: string; contentIndex?: number; delta?: string; toolCall?: { id: string; name: string; arguments?: unknown } } }).assistantMessageEvent;
        if (!inner) return;
        switch (inner.type) {
          case "text_start":
          case "thinking_start": {
            const mid = ensureStarted();
            const partIndex = nextPartIndex++;
            const partType = inner.type === "thinking_start" ? "thinking" : "text";
            openParts.set(inner.contentIndex!, { partIndex, type: partType });
            emit({ type: "part.opened", messageId: mid, partIndex, partType });
            return;
          }
          case "text_delta":
          case "thinking_delta": {
            const part = openParts.get(inner.contentIndex!);
            if (part && currentMessageId) emit({ type: "part.delta", messageId: currentMessageId, partIndex: part.partIndex, delta: inner.delta ?? "" });
            return;
          }
          case "text_end":
          case "thinking_end": {
            const part = openParts.get(inner.contentIndex!);
            if (part && currentMessageId) emit({ type: "part.closed", messageId: currentMessageId, partIndex: part.partIndex });
            return;
          }
          case "toolcall_end": {
            const mid = ensureStarted();
            const call = inner.toolCall!;
            const partIndex = nextPartIndex++;
            toolParts.set(call.id, { partIndex, messageId: mid });
            emit({ type: "part.opened", messageId: mid, partIndex, partType: "tool", toolName: call.name });
            emit({ type: "part.delta", messageId: mid, partIndex, delta: JSON.stringify(call.arguments ?? {}) });
            emit({ type: "part.closed", messageId: mid, partIndex });
            return;
          }
        }
        return;
      }
      case "message_end": {
        const message = (event as { message?: { role?: string; usage?: { input: number; output: number; totalTokens: number; cost?: { total?: number } } } }).message;
        if (message?.role === "assistant" && message.usage) {
          const entry = sessions.get(agentId)!;
          const total = entry.usage;
          total.inputTokens += message.usage.input;
          total.outputTokens += message.usage.output;
          total.totalTokens += message.usage.totalTokens;
          total.costUsd += message.usage.cost?.total ?? 0;
          total.contextTokens = message.usage.totalTokens;
          total.contextWindow = entry.contextWindow;
        }
        if (currentMessageId) emit({ type: "message.closed", messageId: currentMessageId });
        currentMessageId = null;
        return;
      }
      case "tool_execution_end": {
        // Fires after the assistant message closed, so use the tool part's
        // own message id, not currentMessageId (already null by now).
        const target = toolParts.get((event as { toolCallId: string }).toolCallId);
        if (!target) return;
        const raw = (event as { result?: { content?: Array<{ text?: string }> } }).result;
        const result = raw?.content?.map((c) => c.text ?? "").join("\n") ?? "";
        const isError = (event as { isError?: boolean }).isError === true;
        emit({
          type: "part.closed",
          messageId: target.messageId,
          partIndex: target.partIndex,
          result,
          ...(isError ? { error: result || "tool failed" } : {}),
        });
        return;
      }
      case "compaction_start": {
        emit({ type: "context.compacted" });
        return;
      }
    }
  });
}

async function runPiEngine(agentId: string, runId: string, text: string, emit: CanonicalEmit): Promise<void> {
  const session = await ensureSession(agentId);
  // Subscribe once per session (first run); pi keeps the session alive.
  const entry = sessions.get(agentId)!;
  if (!entry.bridged) {
    bridgeEvents(agentId, session, emit);
    entry.bridged = true;
  }
  entry.usage = zeroUsage();
  try {
    await session.prompt(text);
    emit({ type: "run.closed", runId, status: "completed", usage: entry.usage });
  } catch (error) {
    emit({ type: "run.closed", runId, status: "error", error: error instanceof Error ? error.message : String(error), usage: entry.usage });
  }
}

export const piEngine: Engine = {
  name: "pi",
  run: ({ agentId, runId, prompt, emit }) => runPiEngine(agentId, runId, prompt, emit),
  stop: (agentId) => sessions.get(agentId)?.session.abort(),
};
