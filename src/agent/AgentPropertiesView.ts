import { createDiv, createEl } from "../dom/dom";
import { ItemView } from "../views/ItemView";
import type { WorkspaceLeaf } from "../workspace/WorkspaceLeaf";
import type { Agent } from "./Agent";
import { openAgent } from "./AgentBuiltin";
import { STRINGS, formatUsage } from "./AgentStrings";
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
    return this.agentId ? STRINGS.properties.displayTextFor(this.agentId) : STRINGS.properties.displayText;
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
      createDiv({ cls: "agent-view-empty", text: STRINGS.properties.none, parent: this.contentEl });
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

    const identityEl = this.section(rootEl, "identity", STRINGS.properties.identity);
    this.prop(identityEl, "id", STRINGS.properties.id, this.agentId);

    const statusEl = this.section(rootEl, "status", STRINGS.properties.status);
    this.prop(statusEl, "state", STRINGS.properties.state, state.running ? STRINGS.agentState.running : STRINGS.agentState.idle);
    if (state.lastError) this.prop(statusEl, "error", STRINGS.properties.lastError, state.lastError);

    const activityEl = this.section(rootEl, "activity", STRINGS.properties.activity);
    this.prop(activityEl, "messages", STRINGS.properties.messages, String(state.messages.length));
    this.prop(activityEl, "compactions", STRINGS.properties.compactions, String(state.compactions.length));
    if (state.usage) this.prop(activityEl, "usage", STRINGS.properties.lastRun, formatUsage(state.usage));

    // Config lands here with along-go (engine, model, reasoning effort —
    // agent rows in the DB). The section exists so themes and plugins can
    // already target it.
    const configEl = this.section(rootEl, "config", STRINGS.properties.configuration);
    createDiv({ cls: "agent-view-hint", text: STRINGS.properties.configHint, parent: configEl });

    const actionsEl = this.section(rootEl, "actions", STRINGS.properties.actions);
    const openEl = createEl("button", { cls: "agent-view-action", text: STRINGS.properties.openChat, parent: actionsEl });
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
