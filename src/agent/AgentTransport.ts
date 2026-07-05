import type { AgentEvent } from "./AgentEvent";

// The agent's frontmatter: configuration properties beside the conversation
// body. Known fields plus an open params map, exactly like a note's known
// and custom properties. Truth lives on the bridge (an agent row later);
// PATCH merges — the same channel rename already uses.
export interface AgentProfile {
  model?: string;
  effort?: string;
  // Generation params engines may honor; typed because they are known
  // dials, unlike the open params bag below.
  temperature?: number;
  maxTokens?: number;
  params?: Record<string, string>;
}

export interface AgentSummary {
  id: string;
  title: string | null;
  updatedAt: number;
  running: boolean;
  profile?: AgentProfile;
}

export const DEFAULT_CHAT_BRIDGE_URL = "http://127.0.0.1:8787";

export function resolveChatBridgeUrl(): string {
  try {
    const override = window.localStorage?.getItem("chat-bridge-url");
    if (override) return override;
  } catch {
    // localStorage may be unavailable in some embedding contexts
  }
  try {
    // Desktop: main process resolved a loom sidecar (spawned or external).
    const host = globalThis as { electron?: { ipcRenderer?: { sendSync?(channel: string): unknown } } };
    const loomUrl = host.electron?.ipcRenderer?.sendSync?.("loom-url");
    if (typeof loomUrl === "string" && loomUrl) return loomUrl;
  } catch {
    // Not running under Electron, or the main process hasn't wired the channel.
  }
  return DEFAULT_CHAT_BRIDGE_URL;
}

// A native /streams list entry: Go-marshaled, capitalized fields.
interface StreamSummary {
  ID: string;
  Title: string | null;
  Running: boolean;
  UpdatedAt: number;
}

function toAgentSummary(s: StreamSummary): AgentSummary {
  return { id: s.ID, title: s.Title, updatedAt: s.UpdatedAt, running: s.Running };
}

// REST for commands, SSE for pushes. Internal to the chat module: plugins go
// through Agent and never see this layer.
export class AgentTransport {
  constructor(private readonly baseUrl: string = resolveChatBridgeUrl()) {}

  connect(agentId: string, sinceSeq: number, onEvent: (event: AgentEvent) => void): () => void {
    if (typeof EventSource === "undefined") return () => {};
    const url = `${this.baseUrl}/streams/${encodeURIComponent(agentId)}/events?since=${sinceSeq}`;
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
    const response = await fetch(`${this.baseUrl}/streams/${encodeURIComponent(agentId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, attachments }),
    });
    if (!response.ok) throw new Error(`chat bridge rejected message: ${response.status}`);
  }

  async listAgents(): Promise<AgentSummary[]> {
    const response = await fetch(`${this.baseUrl}/streams`);
    if (!response.ok) return [];
    const payload = (await response.json().catch(() => null)) as { streams?: StreamSummary[] } | null;
    return Array.isArray(payload?.streams) ? payload.streams.map(toAgentSummary) : [];
  }

  async listModels(): Promise<{ models: string[]; efforts: string[] }> {
    const response = await fetch(`${this.baseUrl}/models`).catch(() => null);
    if (!response?.ok) return { models: [], efforts: [] };
    const payload = (await response.json().catch(() => null)) as { models?: string[]; efforts?: string[] } | null;
    return {
      models: Array.isArray(payload?.models) ? payload.models : [],
      efforts: Array.isArray(payload?.efforts) ? payload.efforts : [],
    };
  }

  async getAgent(agentId: string): Promise<AgentSummary | null> {
    const response = await fetch(`${this.baseUrl}/agents/${encodeURIComponent(agentId)}`).catch(() => null);
    if (!response?.ok) return null;
    return (await response.json().catch(() => null)) as AgentSummary | null;
  }

  async updateProfile(agentId: string, profile: AgentProfile): Promise<void> {
    await fetch(`${this.baseUrl}/agents/${encodeURIComponent(agentId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile }),
    });
  }

  async rename(agentId: string, title: string): Promise<void> {
    await fetch(`${this.baseUrl}/streams/${encodeURIComponent(agentId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
  }

  async delete(agentId: string): Promise<void> {
    await fetch(`${this.baseUrl}/streams/${encodeURIComponent(agentId)}`, { method: "DELETE" });
  }

  async stop(agentId: string): Promise<void> {
    // Best effort: interrupting a run that already ended is not an error.
    await fetch(`${this.baseUrl}/streams/${encodeURIComponent(agentId)}/stop`, { method: "POST" }).catch(() => undefined);
  }

  async resolvePermission(agentId: string, requestId: string, decision: "allow" | "deny"): Promise<void> {
    // Best effort: the request may have already timed out or been cancelled
    // on the kernel side by the time the user clicks.
    await fetch(`${this.baseUrl}/streams/${encodeURIComponent(agentId)}/permissions/${encodeURIComponent(requestId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    }).catch(() => undefined);
  }
}
