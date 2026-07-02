// Pi engine adapter: one persistent AgentSession per agent, pi events mapped
// to our canonical events. This is the faithful prototype of the along-go
// Worker — pi is what along-go reimplements in Go, so mapping here is close
// to identity and the along-go port inherits it.
import { AuthStorage, ModelRegistry, createAgentSession, type AgentSession } from "@earendil-works/pi-coding-agent";

export interface CanonicalEmit {
  (event: { type: string; [key: string]: unknown }): void;
}

const DEFAULT_MODEL = process.env.PI_MODEL ?? "claude-sonnet-4-5";

const sessions = new Map<string, { session: AgentSession; counter: number }>();

async function ensureSession(agentId: string): Promise<AgentSession> {
  const existing = sessions.get(agentId);
  if (existing) return existing.session;

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = modelRegistry.find("anthropic", DEFAULT_MODEL);
  if (!model) throw new Error(`Unknown model anthropic/${DEFAULT_MODEL}`);

  const { session } = await createAgentSession({ model, modelRegistry, authStorage });
  sessions.set(agentId, { session, counter: 0 });
  return session;
}

// Pi emits structured events already; the transform is mostly a rename plus
// splitting assistant-message deltas into our text/thinking/tool parts.
// ponytail: mapping is derived from pi's typed event union but not yet
// runtime-verified against real assistant output (needs an anthropic key);
// the structural shape is proven, adjust field names on first keyed run.
function bridgeEvents(agentId: string, session: AgentSession, emit: CanonicalEmit): void {
  const messageId = () => `${agentId}-a${(sessions.get(agentId)!.counter += 1)}`;
  let currentMessageId: string | null = null;
  // pi content index -> our part index + type; tool calls carry their id.
  const openParts = new Map<number, { partIndex: number; type: string }>();
  const toolParts = new Map<string, { partIndex: number }>();
  let nextPartIndex = 0;

  session.subscribe((event) => {
    switch (event.type) {
      case "message_start": {
        currentMessageId = messageId();
        openParts.clear();
        nextPartIndex = 0;
        emit({ type: "message.started", messageId: currentMessageId, role: "assistant" });
        return;
      }
      case "message_update": {
        if (!currentMessageId) return;
        const inner = (event as { assistantMessageEvent?: { type: string; contentIndex?: number; delta?: string; toolCall?: { id: string; name: string; arguments?: unknown } } }).assistantMessageEvent;
        if (!inner) return;
        const mid = currentMessageId;
        switch (inner.type) {
          case "text_start":
          case "thinking_start": {
            const partIndex = nextPartIndex++;
            const partType = inner.type === "thinking_start" ? "thinking" : "text";
            openParts.set(inner.contentIndex!, { partIndex, type: partType });
            emit({ type: "part.opened", messageId: mid, partIndex, partType });
            return;
          }
          case "text_delta":
          case "thinking_delta": {
            const part = openParts.get(inner.contentIndex!);
            if (part) emit({ type: "part.delta", messageId: mid, partIndex: part.partIndex, delta: inner.delta ?? "" });
            return;
          }
          case "text_end":
          case "thinking_end": {
            const part = openParts.get(inner.contentIndex!);
            if (part) emit({ type: "part.closed", messageId: mid, partIndex: part.partIndex });
            return;
          }
          case "toolcall_end": {
            const call = inner.toolCall!;
            const partIndex = nextPartIndex++;
            toolParts.set(call.id, { partIndex });
            emit({ type: "part.opened", messageId: mid, partIndex, partType: "tool", toolName: call.name });
            emit({ type: "part.delta", messageId: mid, partIndex, delta: JSON.stringify(call.arguments ?? {}) });
            emit({ type: "part.closed", messageId: mid, partIndex });
            return;
          }
        }
        return;
      }
      case "message_end": {
        if (currentMessageId) emit({ type: "message.closed", messageId: currentMessageId });
        currentMessageId = null;
        return;
      }
      case "tool_execution_end": {
        const target = toolParts.get((event as { toolCallId: string }).toolCallId);
        if (!target || !currentMessageId) return;
        const raw = (event as { result?: { content?: Array<{ text?: string }> } }).result;
        const result = raw?.content?.map((c) => c.text ?? "").join("\n") ?? "";
        emit({ type: "part.closed", messageId: currentMessageId, partIndex: target.partIndex, result });
        return;
      }
      case "compaction_start": {
        emit({ type: "context.compacted" });
        return;
      }
    }
  });
}

export async function runPiEngine(agentId: string, runId: string, text: string, emit: CanonicalEmit): Promise<void> {
  const session = await ensureSession(agentId);
  // Subscribe once per session (first run); pi keeps the session alive.
  const entry = sessions.get(agentId)!;
  if (!(entry as { bridged?: boolean }).bridged) {
    bridgeEvents(agentId, session, emit);
    (entry as { bridged?: boolean }).bridged = true;
  }
  try {
    await session.prompt(text);
    emit({ type: "run.closed", runId, status: "completed" });
  } catch (error) {
    emit({ type: "run.closed", runId, status: "error", error: error instanceof Error ? error.message : String(error) });
  }
}

export function abortPiAgent(agentId: string): void {
  sessions.get(agentId)?.session.abort();
}
