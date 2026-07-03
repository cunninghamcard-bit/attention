import { Events } from "../core/Events";
import type { AgentEvent, AgentUsage, ChatPartType, ChatRole } from "./AgentEvent";
import type { AgentTransport } from "./AgentTransport";

interface ChatPartBase {
  closed: boolean;
  // Producer timestamps (event.ts), when the bridge stamps them; durations
  // survive history replay because they never come from the local clock.
  openedAt?: number;
  closedAt?: number;
}

export interface TextChatPart extends ChatPartBase {
  type: "text" | "thinking";
  markdown: string;
}

export interface ToolChatPart extends ChatPartBase {
  type: "tool";
  toolName: string;
  input: string;
  result?: string;
  // Presence means the execution failed; holds the engine's error text.
  error?: string;
}

export interface AttachmentChatPart extends ChatPartBase {
  type: "attachment";
  name: string;
  content: string;
}

export type ChatPart = TextChatPart | ToolChatPart | AttachmentChatPart;

export interface ChatAttachmentPayload {
  name: string;
  content: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  parts: ChatPart[];
  closed: boolean;
}

export interface ChatCompaction {
  afterMessageId: string | null;
  preTokens?: number;
}

export interface AgentState {
  messages: ChatMessage[];
  compactions: ChatCompaction[];
  running: boolean;
  lastSeq: number;
  lastError: string | null;
  // Last run's token usage; the context bar reads this.
  usage: AgentUsage | null;
}

export function createAgentState(): AgentState {
  return { messages: [], compactions: [], running: false, lastSeq: 0, lastError: null, usage: null };
}

function createPart(partType: ChatPartType, toolName?: string, name?: string): ChatPart {
  if (partType === "tool") return { type: "tool", toolName: toolName ?? "unknown", input: "", closed: false };
  if (partType === "attachment") return { type: "attachment", name: name ?? "attachment", content: "", closed: false };
  return { type: partType, markdown: "", closed: false };
}

// The single reduce step shared by live SSE and history replay. Events with a
// seq at or below state.lastSeq are replays and are dropped.
export function applyAgentEvent(state: AgentState, event: AgentEvent): boolean {
  if (event.seq <= state.lastSeq) return false;
  state.lastSeq = event.seq;

  switch (event.type) {
    case "run.started": {
      state.running = true;
      state.lastError = null;
      break;
    }
    case "message.started": {
      state.messages.push({ id: event.messageId, role: event.role, parts: [], closed: false });
      break;
    }
    case "part.opened": {
      const message = state.messages.find((item) => item.id === event.messageId);
      if (!message) return false;
      const part = createPart(event.partType, event.toolName, event.name);
      part.openedAt = event.ts;
      message.parts[event.partIndex] = part;
      break;
    }
    case "part.delta": {
      const part = state.messages.find((item) => item.id === event.messageId)?.parts[event.partIndex];
      if (!part) return false;
      if (part.type === "tool") part.input += event.delta;
      else if (part.type === "attachment") part.content += event.delta;
      else part.markdown += event.delta;
      break;
    }
    case "part.closed": {
      const part = state.messages.find((item) => item.id === event.messageId)?.parts[event.partIndex];
      if (!part) return false;
      part.closed = true;
      part.closedAt = event.ts ?? part.closedAt;
      if (part.type === "tool") {
        if (event.result !== undefined) part.result = event.result;
        if (event.error !== undefined) part.error = event.error;
      }
      break;
    }
    case "message.closed": {
      const message = state.messages.find((item) => item.id === event.messageId);
      if (!message) return false;
      message.closed = true;
      for (const part of message.parts) part.closed = true;
      break;
    }
    case "context.compacted": {
      const lastMessage = state.messages[state.messages.length - 1];
      state.compactions.push({
        afterMessageId: event.afterMessageId ?? lastMessage?.id ?? null,
        preTokens: event.preTokens,
      });
      break;
    }
    case "run.closed": {
      state.running = false;
      if (event.usage) state.usage = event.usage;
      if (event.status === "error") state.lastError = event.error ?? "Run failed";
      for (const message of state.messages) {
        message.closed = true;
        for (const part of message.parts) part.closed = true;
      }
      break;
    }
  }
  return true;
}

// Frontend single source of truth for one thread. Views and plugins read it
// and subscribe to it; the transport stays behind it.
export class Agent extends Events {
  readonly state = createAgentState();
  private disconnect: (() => void) | null = null;

  constructor(
    readonly agentId: string,
    private readonly transport: AgentTransport | null = null,
  ) {
    super();
  }

  connect(): void {
    if (this.disconnect || !this.transport) return;
    this.disconnect = this.transport.connect(this.agentId, this.state.lastSeq, (event) => this.applyEvent(event));
  }

  applyEvent(event: AgentEvent): void {
    if (!applyAgentEvent(this.state, event)) return;
    if (event.type === "part.delta") this.trigger("delta", event.messageId, event.partIndex);
    this.trigger("changed");
  }

  getMessages(): readonly ChatMessage[] {
    return this.state.messages;
  }

  isRunning(): boolean {
    return this.state.running;
  }

  async sendMessage(text: string, attachments: ChatAttachmentPayload[] = []): Promise<void> {
    if (!this.transport) return;
    await this.transport.sendMessage(this.agentId, text, attachments);
  }

  async stop(): Promise<void> {
    if (!this.transport) return;
    await this.transport.stop(this.agentId);
  }

  destroy(): void {
    this.disconnect?.();
    this.disconnect = null;
  }
}

export function chatMessageToMarkdown(message: ChatMessage): string {
  const parts: string[] = [];
  for (const part of message.parts) {
    if (!part) continue;
    if (part.type === "tool") {
      const result = part.result !== undefined ? `\n${part.result}` : "";
      parts.push(`\`\`\`tool ${part.toolName}\n${part.input}${result}\n\`\`\``);
    } else if (part.type === "attachment") {
      parts.push(`\`\`\`attachment ${part.name}\n${part.content}\n\`\`\``);
    } else if (part.type === "thinking") {
      if (part.markdown.trim()) parts.push(`> ${part.markdown.trim().split("\n").join("\n> ")}`);
    } else {
      if (part.markdown.trim()) parts.push(part.markdown.trim());
    }
  }
  return parts.join("\n\n");
}

export function chatTranscriptToMarkdown(messages: readonly ChatMessage[]): string {
  return messages
    .map((message) => `**${message.role === "user" ? "You" : "Assistant"}**\n\n${chatMessageToMarkdown(message)}`)
    .join("\n\n---\n\n");
}

