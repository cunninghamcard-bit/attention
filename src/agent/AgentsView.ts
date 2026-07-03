import type { App } from "../app/App";
import { createDiv, createSpan } from "../dom/dom";
import { Menu } from "../ui/Menu";
import { ItemView } from "../views/ItemView";
import type { WorkspaceLeaf } from "../workspace/WorkspaceLeaf";
import { openAgent, openAgentProperties } from "./AgentBuiltin";
import { ensureChatStyles } from "./ChatStyles";
import { AgentTransport, type AgentSummary } from "./AgentTransport";
import { ChatView } from "./ChatView";

export const AGENTS_VIEW_TYPE = "agents";

const REFRESH_INTERVAL_MS = 5000;

function formatRelativeTime(timestamp: number): string {
  const deltaSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 60) return "just now";
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h ago`;
  return `${Math.floor(deltaSeconds / 86400)}d ago`;
}

// One context menu for an agent item, shared by every surface that lists
// agents (sidebar, board): Properties / Rename / Delete.
export function showAgentMenu(app: App, transport: AgentTransport, agent: AgentSummary, event: MouseEvent, onChanged: () => void): void {
  event.preventDefault();
  const menu = new Menu(eventDocument(event));
  menu.addItem((item) => item
    .setTitle("Properties")
    .setIcon("lucide-bot")
    .onClick(() => void openAgentProperties(app, agent.id)));
  menu.addItem((item) => item
    .setTitle("Rename")
    .setIcon("lucide-pencil")
    .onClick(() => {
      // ponytail: window.prompt over a custom modal; upgrade when a shared
      // prompt modal exists in the ui module.
      const title = window.prompt("Rename agent", agent.title ?? agent.id);
      if (title?.trim()) void transport.rename(agent.id, title.trim()).then(onChanged);
    }));
  menu.addItem((item) => item
    .setTitle("Delete")
    .setIcon("lucide-trash-2")
    .onClick(() => {
      if (window.confirm(`Delete agent "${agent.title ?? agent.id}"? Its history goes with it.`)) {
        void transport.delete(agent.id).then(onChanged);
      }
    }));
  menu.showAtMouseEvent(event);
}

function eventDocument(event: MouseEvent): Document {
  return (event.target as HTMLElement | null)?.ownerDocument ?? document;
}

// Sidebar list of conversations, the TagPane/Backlinks of the chat world:
// the bridge is the source of truth, the view polls while open.
export class AgentsView extends ItemView {
  override icon = "lucide-messages-square";
  private readonly transport = new AgentTransport();
  private listEl: HTMLElement | null = null;
  private agents: AgentSummary[] = [];

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return AGENTS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Agents";
  }

  async onOpen(): Promise<void> {
    ensureChatStyles(this.app);
    this.contentEl.classList.add("agents-view");
    this.listEl = createDiv("agents-list", this.contentEl);
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.render()));
    this.registerInterval(window.setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS));
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      this.agents = await this.transport.listAgents();
    } catch {
      this.agents = [];
    }
    this.render();
  }

  private activeThreadId(): string | null {
    const view = this.app.workspace.getActiveViewOfType(ChatView);
    if (!view) return null;
    const state = view.getState();
    return typeof state.agentId === "string" ? state.agentId : null;
  }

  private render(): void {
    if (!this.listEl) return;
    this.listEl.empty();
    if (this.agents.length === 0) {
      createDiv({ cls: "agents-empty", text: "No agents yet.", parent: this.listEl });
      return;
    }
    const activeId = this.activeThreadId();
    for (const thread of this.agents) {
      const itemEl = createDiv(`agent-item${thread.id === activeId ? " is-active" : ""}`, this.listEl);
      const titleEl = createDiv("agent-item-title", itemEl);
      if (thread.running) createSpan({ cls: "agent-item-running", parent: titleEl });
      titleEl.appendText(thread.title ?? thread.id);
      createDiv({ cls: "agent-item-time", text: formatRelativeTime(thread.updatedAt), parent: itemEl });
      itemEl.addEventListener("click", () => void openAgent(this.app, thread.id));
      itemEl.addEventListener("contextmenu", (event) => showAgentMenu(this.app, this.transport, thread, event, () => void this.refresh()));
    }
  }
}
