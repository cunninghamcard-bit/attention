import type { AgentEvent } from "./AgentEvent";

// The kernel's Agent entity — the exact wire shape of GET/POST /agents
// (camelCase, frozen in PROTOCOL.md). env values arrive masked ("•••")
// unless they are $NAME references; a masked value must never be posted
// back (the kernel refuses it), so updates omit env entirely.
export interface KernelAgent {
  id: string;
  type?: string;
  name: string;
  harness: string;
  model?: string;
  instructions?: string;
  env?: Record<string, string>;
  args?: string[];
  thinking?: string;
  origin?: string; // "" = api/cli-owned, "file" = agents-dir managed (writes 409)
  home?: string;
}

// A harness's self-declared capabilities (GET /harnesses) — dropdowns
// come from here, never hardcoded harness knowledge.
export interface HarnessCapabilities {
  name: string;
  thinkingLevels?: string[];
  modelHint?: string;
  envHints?: string[];
  supportsResume?: boolean;
}

// One edge of the graph (GET/POST/DELETE /links). Open vocabulary; the
// UI mostly reads member (agent→thread) and forked-from (thread→thread).
export interface KernelLink {
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
  type: string;
}

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
  try {
    // Desktop: main process resolved a loom sidecar (spawned or external).
    const host = globalThis as {
      electron?: { ipcRenderer?: { sendSync?(channel: string): unknown } };
    };
    const loomUrl = host.electron?.ipcRenderer?.sendSync?.("loom-url");
    if (typeof loomUrl === "string" && loomUrl) return loomUrl;
  } catch {
    // Not running under Electron, or the main process hasn't wired the channel.
  }
  return DEFAULT_CHAT_BRIDGE_URL;
}

// A native /threads list entry — the kernel's frozen camelCase wire.
interface ThreadSummary {
  id: string;
  title: string;
  running: boolean;
  updatedAt: number;
}

function toAgentSummary(t: ThreadSummary): AgentSummary {
  return { id: t.id, title: t.title || null, updatedAt: t.updatedAt, running: t.running };
}

// REST for commands, SSE for pushes. Internal to the chat module: plugins go
// through Agent and never see this layer.
export class AgentTransport {
  constructor(private readonly baseUrl: string = resolveChatBridgeUrl()) {}

  connect(agentId: string, sinceSeq: number, onEvent: (event: AgentEvent) => void): () => void {
    if (typeof EventSource === "undefined") return () => {};
    const url = `${this.baseUrl}/threads/${encodeURIComponent(agentId)}/events?since=${sinceSeq}`;
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

  async sendMessage(
    agentId: string,
    text: string,
    attachments: Array<{ name: string; content: string }> = [],
  ): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/threads/${encodeURIComponent(agentId)}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, attachments }),
      },
    );
    if (!response.ok) {
      // The kernel's {error} is the user-facing guidance (fail-fast
      // messages tell you what to configure) — surface it, not a code.
      const detail = ((await response.json().catch(() => null)) as { error?: string } | null)
        ?.error;
      throw new Error(detail || `chat bridge rejected message: ${response.status}`);
    }
  }

  async listAgents(): Promise<AgentSummary[]> {
    const response = await fetch(`${this.baseUrl}/threads`);
    if (!response.ok) return [];
    const payload = (await response.json().catch(() => null)) as {
      threads?: ThreadSummary[];
    } | null;
    return Array.isArray(payload?.threads) ? payload.threads.map(toAgentSummary) : [];
  }

  // ── kernel config surface ─────────────────────────────────────────────

  async listHarnesses(): Promise<HarnessCapabilities[]> {
    const response = await fetch(`${this.baseUrl}/harnesses`).catch(() => null);
    if (!response?.ok) return [];
    const payload = (await response.json().catch(() => null)) as {
      harnesses?: HarnessCapabilities[];
    } | null;
    return Array.isArray(payload?.harnesses) ? payload.harnesses : [];
  }

  async listAgentEntities(): Promise<KernelAgent[]> {
    const response = await fetch(`${this.baseUrl}/agents`).catch(() => null);
    if (!response?.ok) return [];
    const payload = (await response.json().catch(() => null)) as { agents?: KernelAgent[] } | null;
    return Array.isArray(payload?.agents) ? payload.agents : [];
  }

  async getAgentEntity(id: string): Promise<KernelAgent | null> {
    const response = await fetch(`${this.baseUrl}/agents/${encodeURIComponent(id)}`).catch(
      () => null,
    );
    if (!response?.ok) return null;
    return (await response.json().catch(() => null)) as KernelAgent | null;
  }

  // Upsert. Callers editing config must OMIT env (the kernel preserves
  // stored values when the field is absent; masked values are refused).
  async putAgent(agent: KernelAgent): Promise<void> {
    const response = await fetch(`${this.baseUrl}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(agent),
    });
    if (!response.ok) {
      const detail = ((await response.json().catch(() => null)) as { error?: string } | null)
        ?.error;
      throw new Error(detail || `agent save rejected: ${response.status}`);
    }
  }

  async deleteAgent(id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/agents/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const detail = ((await response.json().catch(() => null)) as { error?: string } | null)
        ?.error;
      throw new Error(detail || `agent delete rejected: ${response.status}`);
    }
  }

  async listLinks(filter: Partial<KernelLink> = {}): Promise<KernelLink[]> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filter)) if (value) query.set(key, value);
    const response = await fetch(`${this.baseUrl}/links?${query}`).catch(() => null);
    if (!response?.ok) return [];
    const payload = (await response.json().catch(() => null)) as { links?: KernelLink[] } | null;
    return Array.isArray(payload?.links) ? payload.links : [];
  }

  async putLink(link: KernelLink): Promise<void> {
    const response = await fetch(`${this.baseUrl}/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(link),
    });
    if (!response.ok) {
      const detail = ((await response.json().catch(() => null)) as { error?: string } | null)
        ?.error;
      throw new Error(detail || `link rejected: ${response.status}`);
    }
  }

  async deleteLink(link: KernelLink): Promise<void> {
    await fetch(`${this.baseUrl}/links`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(link),
    }).catch(() => undefined);
  }

  // The thread's member agents, in link order — the first is the one the
  // composer's model chip reflects.
  async memberAgents(threadId: string): Promise<KernelAgent[]> {
    const links = await this.listLinks({ toType: "thread", toId: threadId, type: "member" });
    const agents = await Promise.all(links.map((link) => this.getAgentEntity(link.fromId)));
    return agents.filter((agent): agent is KernelAgent => agent !== null);
  }

  async createThread(id?: string, title?: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title }),
    });
    if (!response.ok) {
      const detail = ((await response.json().catch(() => null)) as { error?: string } | null)
        ?.error;
      throw new Error(detail || `thread create rejected: ${response.status}`);
    }
    return ((await response.json()) as { id: string }).id;
  }

  // Fork: new thread carrying every member's harness-session context.
  async forkThread(threadId: string, title?: string): Promise<{ id: string; forkedFrom: string }> {
    const response = await fetch(`${this.baseUrl}/threads/${encodeURIComponent(threadId)}/fork`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) {
      const detail = ((await response.json().catch(() => null)) as { error?: string } | null)
        ?.error;
      throw new Error(detail || `fork rejected: ${response.status}`);
    }
    return (await response.json()) as { id: string; forkedFrom: string };
  }

  async health(): Promise<{ status: string; version?: string; schemaVersion?: number } | null> {
    // Guarded: the status bar polls from its constructor, which also runs
    // under jsdom where fetch does not exist at all.
    if (typeof fetch !== "function") return null;
    const response = await fetch(`${this.baseUrl}/health`).catch(() => null);
    if (!response?.ok) return null;
    return (await response.json().catch(() => null)) as {
      status: string;
      version?: string;
      schemaVersion?: number;
    } | null;
  }

  async rename(agentId: string, title: string): Promise<void> {
    await fetch(`${this.baseUrl}/threads/${encodeURIComponent(agentId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
  }

  async delete(agentId: string): Promise<void> {
    await fetch(`${this.baseUrl}/threads/${encodeURIComponent(agentId)}`, { method: "DELETE" });
  }

  async listCommands(
    agentId: string,
  ): Promise<Array<{ name: string; description?: string; source?: string; agentId: string }>> {
    const response = await fetch(
      `${this.baseUrl}/threads/${encodeURIComponent(agentId)}/commands`,
    ).catch(() => null);
    if (!response?.ok) return [];
    const payload = (await response.json().catch(() => null)) as {
      commands?: Array<{ name: string; description?: string; source?: string; agentId: string }>;
    } | null;
    return Array.isArray(payload?.commands) ? payload.commands : [];
  }

  async steer(agentId: string, input: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/threads/${encodeURIComponent(agentId)}/steer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    });
    if (!response.ok) {
      const detail = ((await response.json().catch(() => null)) as { error?: string } | null)
        ?.error;
      throw new Error(detail || `steer rejected: ${response.status}`);
    }
  }

  async stop(agentId: string): Promise<void> {
    // Best effort: interrupting a run that already ended is not an error.
    await fetch(`${this.baseUrl}/threads/${encodeURIComponent(agentId)}/stop`, {
      method: "POST",
    }).catch(() => undefined);
  }

  async resolvePermission(
    agentId: string,
    requestId: string,
    decision: "allow" | "deny",
  ): Promise<void> {
    // Best effort: the request may have already timed out or been cancelled
    // on the kernel side by the time the user clicks.
    await fetch(
      `${this.baseUrl}/threads/${encodeURIComponent(agentId)}/permissions/${encodeURIComponent(requestId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      },
    ).catch(() => undefined);
  }
}
