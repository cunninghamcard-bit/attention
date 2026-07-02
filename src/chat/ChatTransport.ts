import type { ChatEvent } from "./ChatEvent";

export const DEFAULT_CHAT_BRIDGE_URL = "http://127.0.0.1:8787";

export function resolveChatBridgeUrl(): string {
  try {
    const override = window.localStorage?.getItem("chat-bridge-url");
    if (override) return override;
  } catch {
    // localStorage may be unavailable in some embedding contexts
  }
  return DEFAULT_CHAT_BRIDGE_URL;
}

// REST for commands, SSE for pushes. Internal to the chat module: plugins go
// through ChatSession and never see this layer.
export class ChatTransport {
  constructor(private readonly baseUrl: string = resolveChatBridgeUrl()) {}

  connect(threadId: string, sinceSeq: number, onEvent: (event: ChatEvent) => void): () => void {
    if (typeof EventSource === "undefined") return () => {};
    const url = `${this.baseUrl}/threads/${encodeURIComponent(threadId)}/events?since=${sinceSeq}`;
    const source = new EventSource(url);
    source.onmessage = (message) => {
      try {
        onEvent(JSON.parse(message.data) as ChatEvent);
      } catch (error) {
        console.error("chat: dropped malformed event", error);
      }
    };
    return () => source.close();
  }

  async sendMessage(threadId: string, text: string, attachments: Array<{ name: string; content: string }> = []): Promise<void> {
    const response = await fetch(`${this.baseUrl}/threads/${encodeURIComponent(threadId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, attachments }),
    });
    if (!response.ok) throw new Error(`chat bridge rejected message: ${response.status}`);
  }

  async stop(threadId: string): Promise<void> {
    // Best effort: interrupting a run that already ended is not an error.
    await fetch(`${this.baseUrl}/threads/${encodeURIComponent(threadId)}/stop`, { method: "POST" }).catch(() => undefined);
  }
}
