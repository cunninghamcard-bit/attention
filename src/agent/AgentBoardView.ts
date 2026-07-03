import { createDiv, createEl, createSpan } from "../dom/dom";
import { ItemView } from "../views/ItemView";
import type { WorkspaceLeaf } from "../workspace/WorkspaceLeaf";
import { openAgent, openAgentProperties } from "./AgentBuiltin";
import { newAgentId } from "./AgentManager";
import { AgentTransport, type AgentSummary } from "./AgentTransport";
import { showAgentMenu } from "./AgentsView";
import { ensureChatStyles } from "./ChatStyles";

export const AGENT_BOARD_VIEW_TYPE = "agent-board";

const REFRESH_INTERVAL_MS = 3000;

function formatRelativeTime(timestamp: number): string {
  const deltaSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 60) return "just now";
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h ago`;
  return `${Math.floor(deltaSeconds / 86400)}d ago`;
}

// The fleet view: every agent as a card in the main area — who is running,
// who is idle, what they cost. AgentsView is the compact navigator in the
// sidebar; the board is the workbench view of the same population, the way
// GraphView is to the file explorer. Skeleton first: cards carry stable
// classes (.agent-card[data-agent-id], .agent-card-*) so richer cells
// (live activity snippet, per-card sparkline) land without re-plumbing.
export class AgentBoardView extends ItemView {
  override icon = "lucide-layout-grid";
  override navigation = true;
  private readonly transport = new AgentTransport();
  private gridEl: HTMLElement | null = null;
  private agents: AgentSummary[] = [];

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return AGENT_BOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Agent board";
  }

  async onOpen(): Promise<void> {
    ensureChatStyles(this.app);
    this.contentEl.classList.add("agent-board-view");
    const headerEl = createDiv("agent-board-header", this.contentEl);
    createDiv({ cls: "agent-board-title", text: "Agents", parent: headerEl });
    const newAgentEl = createEl("button", { cls: "agent-board-create", text: "New agent", parent: headerEl });
    newAgentEl.addEventListener("click", () => void openAgent(this.app, newAgentId()));
    this.gridEl = createDiv("agent-board-grid", this.contentEl);
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

  private render(): void {
    if (!this.gridEl) return;
    this.gridEl.empty();
    if (this.agents.length === 0) {
      createDiv({ cls: "agent-board-empty", text: "No agents yet. Create one to get started.", parent: this.gridEl });
      return;
    }
    for (const agent of this.agents) this.renderCard(agent);
  }

  private renderCard(agent: AgentSummary): void {
    const cardEl = createDiv(`agent-card${agent.running ? " is-running" : ""}`, this.gridEl!);
    cardEl.dataset.agentId = agent.id;

    const headerEl = createDiv("agent-card-header", cardEl);
    createSpan({ cls: "agent-card-status", parent: headerEl });
    createDiv({ cls: "agent-card-title", text: agent.title ?? agent.id, parent: headerEl });

    const metaEl = createDiv("agent-card-meta", cardEl);
    createSpan({ cls: "agent-card-state", text: agent.running ? "Running" : "Idle", parent: metaEl });
    createSpan({ cls: "agent-card-time", text: formatRelativeTime(agent.updatedAt), parent: metaEl });

    // Usage renders only for agents this window has already connected to;
    // the board never opens SSE connections just to fill a cell.
    const usage = this.app.agents.peek(agent.id)?.state.usage;
    if (usage) {
      const cost = usage.costUsd ? ` · $${usage.costUsd.toFixed(3)}` : "";
      createDiv({ cls: "agent-card-usage", text: `${(usage.totalTokens / 1000).toFixed(1)}k tokens${cost}`, parent: cardEl });
    }

    const actionsEl = createDiv("agent-card-actions", cardEl);
    const chatEl = createEl("button", { cls: "agent-card-action", text: "Chat", parent: actionsEl });
    chatEl.addEventListener("click", (event) => {
      event.stopPropagation();
      void openAgent(this.app, agent.id);
    });
    const propsEl = createEl("button", { cls: "agent-card-action", text: "Properties", parent: actionsEl });
    propsEl.addEventListener("click", (event) => {
      event.stopPropagation();
      void openAgentProperties(this.app, agent.id);
    });

    cardEl.addEventListener("click", () => void openAgent(this.app, agent.id));
    cardEl.addEventListener("contextmenu", (event) => showAgentMenu(this.app, this.transport, agent, event, () => void this.refresh()));
  }
}
