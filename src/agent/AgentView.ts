import type { App } from "../app/App";
import { createDiv, createEl, createSpan } from "../dom/dom";
import { Menu } from "../ui/Menu";
import { Notice } from "../ui/Notice";
import { ItemView } from "../views/ItemView";
import type { WorkspaceLeaf } from "../workspace/WorkspaceLeaf";
import { newRoomId, openAgent, openAgentProperties, openRoom } from "./AgentBuiltin";
import { STRINGS, formatRelativeTime, formatUsage } from "./AgentStrings";
import { newAgentId } from "./AgentManager";
import { AgentTransport, type AgentSummary } from "./AgentTransport";
import { ensureChatStyles } from "./ChatStyles";
import { createStatusDot } from "./StatusDot";

// The type string keeps its board heritage; the class carries the product
// vocabulary: AgentView is the view of the agent population.
export const AGENT_VIEW_TYPE = "agent-board";

const REFRESH_INTERVAL_MS = 3000;

// The context menu for one agent card: Properties / Rename / Delete.
export function showAgentMenu(app: App, transport: AgentTransport, agent: AgentSummary, event: MouseEvent, onChanged: () => void): void {
  event.preventDefault();
  const menu = new Menu((event.target as HTMLElement | null)?.ownerDocument ?? document);
  menu.addItem((item) => item
    .setTitle(STRINGS.menu.properties)
    .setIcon("bot")
    .onClick(() => void openAgentProperties(app, agent.id)));
  menu.addItem((item) => item
    .setTitle(STRINGS.menu.rename)
    .setIcon("lucide-pencil")
    .onClick(() => {
      // ponytail: window.prompt over a custom modal; upgrade when a shared
      // prompt modal exists in the ui module.
      const title = window.prompt(STRINGS.menu.renamePrompt, agent.title ?? agent.id);
      if (title?.trim()) void transport.rename(agent.id, title.trim()).then(onChanged);
    }));
  menu.addItem((item) => item
    .setTitle(STRINGS.menu.fork)
    .setIcon("lucide-git-branch")
    .onClick(() => {
      void transport.forkThread(agent.id)
        .then(({ id }) => {
          new Notice(STRINGS.menu.forked(id));
          onChanged();
        })
        .catch((error: unknown) => new Notice(STRINGS.menu.forkFailed(error instanceof Error ? error.message : String(error))));
    }));
  menu.addItem((item) => item
    .setTitle(STRINGS.menu.delete)
    .setIcon("lucide-trash-2")
    .onClick(() => {
      if (window.confirm(STRINGS.menu.deleteConfirm(agent.title ?? agent.id))) {
        void transport.delete(agent.id).then(onChanged);
      }
    }));
  menu.showAtMouseEvent(event);
}

// AgentView shows the agents, plural: every agent as a card — who is
// running, who is idle, what they cost. The product vocabulary:
//   ChatView       one agent (conversing with it IS its main view)
//   AgentView      the agent population (this board)
//   MultiAgentView reserved — several agents conversing in one view
// Skeleton first: cards carry stable classes (.agent-card[data-agent-id],
// .agent-card-*) so richer cells (activity snippet, sparkline) land
// without re-plumbing.
export class AgentView extends ItemView {
  override icon = "lucide-layout-grid";
  override navigation = true;
  private readonly transport = new AgentTransport();
  private gridEl: HTMLElement | null = null;
  private agents: AgentSummary[] = [];

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return AGENT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return STRINGS.board.displayText;
  }

  async onOpen(): Promise<void> {
    ensureChatStyles(this.app);
    this.contentEl.classList.add("agent-board-view");
    const headerEl = createDiv("agent-board-header", this.contentEl);
    createDiv({ cls: "agent-board-title", text: STRINGS.board.title, parent: headerEl });
    const buttonsEl = createDiv("agent-board-buttons", headerEl);
    const newAgentEl = createEl("button", { cls: "agent-board-create", text: STRINGS.board.newAgent, parent: buttonsEl });
    newAgentEl.addEventListener("click", () => void openAgent(this.app, newAgentId()));
    const newRoomEl = createEl("button", { cls: "agent-board-create", text: STRINGS.board.newRoom, parent: buttonsEl });
    newRoomEl.addEventListener("click", () => void openRoom(this.app, newRoomId()));
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
      createDiv({ cls: "agent-board-empty", text: STRINGS.board.empty, parent: this.gridEl });
      return;
    }
    for (const agent of this.agents) this.renderCard(agent);
  }

  private renderCard(agent: AgentSummary): void {
    const cardEl = createDiv(`agent-card${agent.running ? " is-running" : ""}`, this.gridEl!);
    cardEl.dataset.agentId = agent.id;

    const headerEl = createDiv("agent-card-header", cardEl);
    createStatusDot(headerEl, agent.running ? "running" : "idle", "agent-card-status");
    createDiv({ cls: "agent-card-title", text: agent.title ?? agent.id, parent: headerEl });

    const metaEl = createDiv("agent-card-meta", cardEl);
    createSpan({ cls: "agent-card-state", text: agent.running ? STRINGS.agentState.running : STRINGS.agentState.idle, parent: metaEl });
    createSpan({ cls: "agent-card-time", text: formatRelativeTime(agent.updatedAt), parent: metaEl });

    // Usage renders only for agents this window has already connected to;
    // the board never opens SSE connections just to fill a cell.
    const usage = this.app.agents.peek(agent.id)?.state.usage;
    if (usage) createDiv({ cls: "agent-card-usage", text: formatUsage(usage), parent: cardEl });

    const isRoom = agent.id.startsWith("room-");
    const open = isRoom ? openRoom : openAgent;
    const actionsEl = createDiv("agent-card-actions", cardEl);
    const chatEl = createEl("button", { cls: "agent-card-action", text: isRoom ? STRINGS.board.openRoom : STRINGS.board.openChat, parent: actionsEl });
    chatEl.addEventListener("click", (event) => {
      event.stopPropagation();
      void open(this.app, agent.id);
    });
    const propsEl = createEl("button", { cls: "agent-card-action", text: STRINGS.board.openProperties, parent: actionsEl });
    propsEl.addEventListener("click", (event) => {
      event.stopPropagation();
      void openAgentProperties(this.app, agent.id);
    });

    cardEl.addEventListener("click", () => void open(this.app, agent.id));
    cardEl.addEventListener("contextmenu", (event) => showAgentMenu(this.app, this.transport, agent, event, () => void this.refresh()));
  }
}
