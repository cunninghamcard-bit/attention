import { Events } from "../core/Events";
import type { ChatEvent, ChatPartType, ChatRole } from "./ChatEvent";
import type { ChatTransport } from "./ChatTransport";

export interface TextChatPart {
  type: "text" | "thinking";
  markdown: string;
  closed: boolean;
}

export interface ToolChatPart {
  type: "tool";
  toolName: string;
  input: string;
  result?: string;
  closed: boolean;
}

export type ChatPart = TextChatPart | ToolChatPart;

export interface ChatMessage {
  id: string;
  role: ChatRole;
  parts: ChatPart[];
  closed: boolean;
}

export interface ChatSessionState {
  messages: ChatMessage[];
  running: boolean;
  lastSeq: number;
  lastError: string | null;
}

export function createChatSessionState(): ChatSessionState {
  return { messages: [], running: false, lastSeq: 0, lastError: null };
}

function createPart(partType: ChatPartType, toolName?: string): ChatPart {
  if (partType === "tool") return { type: "tool", toolName: toolName ?? "unknown", input: "", closed: false };
  return { type: partType, markdown: "", closed: false };
}

// The single reduce step shared by live SSE and history replay. Events with a
// seq at or below state.lastSeq are replays and are dropped.
export function applyChatEvent(state: ChatSessionState, event: ChatEvent): boolean {
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
      message.parts[event.partIndex] = createPart(event.partType, event.toolName);
      break;
    }
    case "part.delta": {
      const part = state.messages.find((item) => item.id === event.messageId)?.parts[event.partIndex];
      if (!part) return false;
      if (part.type === "tool") part.input += event.delta;
      else part.markdown += event.delta;
      break;
    }
    case "part.closed": {
      const part = state.messages.find((item) => item.id === event.messageId)?.parts[event.partIndex];
      if (!part) return false;
      part.closed = true;
      if (part.type === "tool" && event.result !== undefined) part.result = event.result;
      break;
    }
    case "message.closed": {
      const message = state.messages.find((item) => item.id === event.messageId);
      if (!message) return false;
      message.closed = true;
      for (const part of message.parts) part.closed = true;
      break;
    }
    case "run.closed": {
      state.running = false;
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
export class ChatSession extends Events {
  readonly state = createChatSessionState();
  private disconnect: (() => void) | null = null;

  constructor(
    readonly threadId: string,
    private readonly transport: ChatTransport | null = null,
  ) {
    super();
  }

  connect(): void {
    if (this.disconnect || !this.transport) return;
    this.disconnect = this.transport.connect(this.threadId, this.state.lastSeq, (event) => this.applyEvent(event));
  }

  applyEvent(event: ChatEvent): void {
    if (!applyChatEvent(this.state, event)) return;
    if (event.type === "part.delta") this.trigger("delta", event.messageId, event.partIndex);
    this.trigger("changed");
  }

  getMessages(): readonly ChatMessage[] {
    return this.state.messages;
  }

  isRunning(): boolean {
    return this.state.running;
  }

  async sendMessage(text: string): Promise<void> {
    if (!this.transport) return;
    await this.transport.sendMessage(this.threadId, text);
  }

  async stop(): Promise<void> {
    if (!this.transport) return;
    await this.transport.stop(this.threadId);
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

const sessions = new Map<string, ChatSession>();

// Sessions are shared app-wide so multiple leaves on the same thread render
// from one state. Becomes an App-level manager when chat graduates from
// builtin module to core service.
export function getChatSession(threadId: string, transport: ChatTransport): ChatSession {
  let session = sessions.get(threadId);
  if (!session) {
    session = new ChatSession(threadId, transport);
    session.connect();
    sessions.set(threadId, session);
  }
  return session;
}
