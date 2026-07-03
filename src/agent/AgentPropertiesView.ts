import { createDiv, createEl } from "../dom/dom";
import { ItemView } from "../views/ItemView";
import type { WorkspaceLeaf } from "../workspace/WorkspaceLeaf";
import type { Agent } from "./Agent";
import { openAgent } from "./AgentBuiltin";
import { ensureChatStyles } from "./ChatStyles";

export const AGENT_PROPERTIES_VIEW_TYPE = "agent-properties";

// The properties panel of one agent — a second window onto the entity
// ChatView converses with: who it is, what it is doing, what it has cost.
// ChatView is to the agent what MarkdownView is to a file body; this is
// the frontmatter-properties counterpart. Framework first — sections carry
// stable classes (.agent-view-section[data-section], .agent-prop[data-prop])
// so config rows (engine, model, effort) land here later without
// re-plumbing.
export class AgentPropertiesView extends ItemView {
  override icon = "bot";
  override navigation = true;
  private agentId = "";
  private session: Agent | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return AGENT_PROPERTIES_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.agentId ? `Agent – ${this.agentId}` : "Agent";
  }

  async onOpen(): Promise<void> {
    ensureChatStyles(this.app);
    this.contentEl.classList.add("agent-view");
    this.initFor(this.agentId);
  }

  override async setState(state: unknown, result?: unknown): Promise<void> {
    await super.setState(state, result as never);
    if (state && typeof state === "object" && "agentId" in state) {
      const next = String((state as { agentId?: unknown }).agentId ?? "");
      if (next !== this.agentId) {
        this.agentId = next;
        if (this.contentEl.classList.contains("agent-view")) this.initFor(next);
        this.updateHeader();
      }
    }
  }

  override getState(): Record<string, unknown> {
    return { agentId: this.agentId };
  }

  private initFor(agentId: string): void {
    this.contentEl.empty();
    if (!agentId) {
      createDiv({ cls: "agent-view-empty", text: "No agent selected.", parent: this.contentEl });
      return;
    }
    this.session = this.app.agents.get(agentId);
    this.session.connect();
    this.registerEvent(this.session.on("changed", () => this.render()));
    this.render();
  }

  // The panel is small; a full re-render per change is the simple truth.
  private render(): void {
    if (!this.session) return;
    this.contentEl.empty();
    const state = this.session.state;
    const rootEl = createDiv("agent-view-root", this.contentEl);

    const identityEl = this.section(rootEl, "identity", "Identity");
    this.prop(identityEl, "id", "ID", this.agentId);

    const statusEl = this.section(rootEl, "status", "Status");
    this.prop(statusEl, "state", "State", state.running ? "Running" : "Idle");
    if (state.lastError) this.prop(statusEl, "error", "Last error", state.lastError);

    const activityEl = this.section(rootEl, "activity", "Activity");
    this.prop(activityEl, "messages", "Messages", String(state.messages.length));
    this.prop(activityEl, "compactions", "Compactions", String(state.compactions.length));
    if (state.usage) {
      const cost = state.usage.costUsd ? ` · $${state.usage.costUsd.toFixed(3)}` : "";
      this.prop(activityEl, "usage", "Last run", `${(state.usage.totalTokens / 1000).toFixed(1)}k tokens${cost}`);
    }

    // Config lands here with along-go (engine, model, reasoning effort —
    // agent rows in the DB). The section exists so themes and plugins can
    // already target it.
    const configEl = this.section(rootEl, "config", "Configuration");
    createDiv({ cls: "agent-view-hint", text: "Engine and model configuration arrives with the Go backend.", parent: configEl });

    const actionsEl = this.section(rootEl, "actions", "Actions");
    const openEl = createEl("button", { cls: "agent-view-action", text: "Open chat", parent: actionsEl });
    openEl.addEventListener("click", () => void openAgent(this.app, this.agentId));
  }

  private section(parentEl: HTMLElement, key: string, title: string): HTMLElement {
    const el = createDiv("agent-view-section", parentEl);
    el.dataset.section = key;
    createDiv({ cls: "agent-view-section-title", text: title, parent: el });
    return el;
  }

  private prop(parentEl: HTMLElement, key: string, label: string, value: string): void {
    const el = createDiv("agent-prop", parentEl);
    el.dataset.prop = key;
    createDiv({ cls: "agent-prop-label", text: label, parent: el });
    createDiv({ cls: "agent-prop-value", text: value, parent: el });
  }
}
