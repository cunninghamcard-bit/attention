import type { App } from "../app/App";
import {
  registerChatComposerAction,
  registerChatComposerExtension,
  registerChatMessageAction,
  registerChatSlashCommand,
  registerChatToolRenderer,
  type ChatComposerAction,
  type ChatMessageAction,
  type ChatSlashCommand,
  type ChatToolRenderer,
} from "./ChatRegistry";
import { Agent } from "./Agent";

export function newAgentId(): string {
  const random = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `agent-${random}`;
}
import { AgentTransport } from "./AgentTransport";
import type { Extension } from "@codemirror/state";

// The chat service on App, the seam plugins reach chat through — they hold
// an app reference and nothing chat-related is exported from the obsidian
// module (that surface stays parity-pure). Sits beside metadataCache and
// customCss as an app-level service.
export class AgentManager {
  private readonly agents = new Map<string, Agent>();

  constructor(readonly app: App) {}

  // Creating an agent is the product's core act: a persistent individual,
  // not a transient session. create() mints one; get() returns the shared
  // instance every leaf showing that agent renders from.
  create(): Agent {
    return this.get(newAgentId());
  }

  get(agentId: string): Agent {
    let agent = this.agents.get(agentId);
    if (!agent) {
      agent = new Agent(agentId, new AgentTransport());
      agent.connect();
      this.agents.set(agentId, agent);
    }
    return agent;
  }

  list(): Agent[] {
    return [...this.agents.values()];
  }

  registerToolRenderer(toolName: string, renderer: ChatToolRenderer): () => void {
    return registerChatToolRenderer(toolName, renderer);
  }

  registerSlashCommand(command: ChatSlashCommand): () => void {
    return registerChatSlashCommand(command);
  }

  registerComposerAction(action: ChatComposerAction): () => void {
    return registerChatComposerAction(action);
  }

  registerMessageAction(action: ChatMessageAction): () => void {
    return registerChatMessageAction(action);
  }

  registerComposerExtension(extension: Extension): () => void {
    return registerChatComposerExtension(extension);
  }
}
