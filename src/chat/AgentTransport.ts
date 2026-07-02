import type { AgentEvent } from "./AgentEvent";

export interface AgentSummary {
  id: string;
  title: string | null;
  updatedAt: number;
  running: boolean;
}

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
// through Agent and never see this layer.
export class AgentTransport {
  constructor(private readonly baseUrl: string = resolveChatBridgeUrl()) {}

  connect(agentId: string, sinceSeq: number, onEvent: (event: AgentEvent) => void): () => void {
    if (typeof EventSource === "undefined") return () => {};
    const url = `${this.baseUrl}/agents/${encodeURIComponent(agentId)}/events?since=${sinceSeq}`;
    const source = new EventSource(url);
    source.onmessage = (message) => {
      try {
        onEvent(JSON.parse(message.data) as AgentEvent);
      } catch (error) {
        console.error("chat: dropped malformed event", error);
      }
    };
    return () => source.close();
  }

  async sendMessage(agentId: string, text: string, attachments: Array<{ name: string; content: string }> = []): Promise<void> {
    const response = await fetch(`${this.baseUrl}/agents/${encodeURIComponent(agentId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, attachments }),
    });
    if (!response.ok) throw new Error(`chat bridge rejected message: ${response.status}`);
  }

  async listAgents(): Promise<AgentSummary[]> {
    const response = await fetch(`${this.baseUrl}/agents`);
    if (!response.ok) return [];
    const payload = (await response.json().catch(() => null)) as { agents?: AgentSummary[] } | null;
    return Array.isArray(payload?.agents) ? payload.agents : [];
  }

  async stop(agentId: string): Promise<void> {
    // Best effort: interrupting a run that already ended is not an error.
    await fetch(`${this.baseUrl}/agents/${encodeURIComponent(agentId)}/stop`, { method: "POST" }).catch(() => undefined);
  }
}
