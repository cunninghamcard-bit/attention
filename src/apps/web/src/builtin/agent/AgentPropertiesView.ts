import { createDiv, createEl } from "../../dom/dom";
import { AgentTransport, type HarnessCapabilities, type KernelAgent } from "./AgentTransport";
import { Notice } from "../../ui/Notice";
import { ItemView } from "../../views/ItemView";
import type { WorkspaceLeaf } from "../../views/workspace/WorkspaceLeaf";
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
  private readonly transport = new AgentTransport();
  // The thread's first member agent entity — the kernel row this panel
  // edits. env arrives masked and is never posted back from here.
  private member: KernelAgent | null = null;
  private capabilities: HarnessCapabilities | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return AGENT_PROPERTIES_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.agentId
      ? STRINGS.properties.displayTextFor(this.agentId)
      : STRINGS.properties.displayText;
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
    void this.transport.memberAgents(agentId).then(async (members) => {
      this.member = members[0] ?? null;
      this.capabilities = this.member
        ? ((await this.transport.listHarnesses()).find((h) => h.name === this.member?.harness) ??
          null)
        : null;
      this.render();
    });
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
    this.prop(
      statusEl,
      "state",
      STRINGS.properties.state,
      state.running ? STRINGS.agentState.running : STRINGS.agentState.idle,
    );
    if (state.lastError)
      this.prop(statusEl, "error", STRINGS.properties.lastError, state.lastError);

    const activityEl = this.section(rootEl, "activity", STRINGS.properties.activity);
    this.prop(activityEl, "messages", STRINGS.properties.messages, String(state.messages.length));
    this.prop(
      activityEl,
      "compactions",
      STRINGS.properties.compactions,
      String(state.compactions.length),
    );
    if (state.usage)
      this.prop(activityEl, "usage", STRINGS.properties.lastRun, formatUsage(state.usage));

    this.renderConfig(rootEl);

    const actionsEl = this.section(rootEl, "actions", STRINGS.properties.actions);
    const openEl = createEl("button", {
      cls: "agent-view-action",
      text: STRINGS.properties.openChat,
      parent: actionsEl,
    });
    openEl.addEventListener("click", () => void openAgent(this.app, this.agentId));
  }

  // The configuration editor mirrors the kernel's Agent entity exactly:
  // name / model / thinking / instructions, with dropdowns fed by the
  // harness's own capability declaration. env is displayed (masked) but
  // never edited here — omitting it on save preserves stored secrets.
  // File-origin agents are read-only: their truth is the .md file.
  private renderConfig(rootEl: HTMLElement): void {
    const configEl = this.section(rootEl, "config", STRINGS.properties.configuration);
    const member = this.member;
    if (!member) {
      createDiv({ cls: "agent-view-hint", text: STRINGS.properties.noMembers, parent: configEl });
      return;
    }
    createDiv({
      cls: "agent-view-hint",
      text: STRINGS.properties.memberAgentFor(member.id),
      parent: configEl,
    });
    const readOnly = member.origin === "file";
    if (readOnly)
      createDiv({ cls: "agent-view-hint", text: STRINGS.properties.fileOrigin, parent: configEl });

    this.prop(configEl, "harness", STRINGS.properties.harness, member.harness);
    if (member.origin) this.prop(configEl, "origin", "Origin", member.origin);

    this.textRow(configEl, "name", "Name", member.name, readOnly, (value) =>
      this.save({ name: value || member.id }),
    );
    this.textRow(
      configEl,
      "model",
      STRINGS.properties.model,
      member.model ?? "",
      readOnly,
      (value) => this.save({ model: value || undefined }),
      this.capabilities?.modelHint || STRINGS.properties.modelPlaceholder,
    );

    const thinkingRow = createDiv("agent-prop", configEl);
    thinkingRow.dataset.prop = "thinking";
    createDiv({ cls: "agent-prop-label", text: STRINGS.properties.thinking, parent: thinkingRow });
    const thinkingSelect = createEl("select", { cls: "agent-prop-input", parent: thinkingRow });
    for (const level of ["", ...(this.capabilities?.thinkingLevels ?? [])]) {
      const option = createEl("option", {
        parent: thinkingSelect,
        text: level || STRINGS.properties.effortDefault,
      });
      option.value = level;
    }
    thinkingSelect.value = member.thinking ?? "";
    thinkingSelect.disabled = readOnly;
    thinkingSelect.addEventListener(
      "change",
      () => void this.save({ thinking: thinkingSelect.value || undefined }),
    );

    const instructionsRow = createDiv("agent-prop agent-prop-block", configEl);
    instructionsRow.dataset.prop = "instructions";
    createDiv({
      cls: "agent-prop-label",
      text: STRINGS.properties.instructions,
      parent: instructionsRow,
    });
    const instructionsInput = createEl("textarea", {
      cls: "agent-prop-input agent-prop-textarea",
      parent: instructionsRow,
    });
    instructionsInput.placeholder = STRINGS.properties.instructionsPlaceholder;
    instructionsInput.value = member.instructions ?? "";
    instructionsInput.disabled = readOnly;
    instructionsInput.addEventListener(
      "change",
      () => void this.save({ instructions: instructionsInput.value }),
    );

    const envEntries = Object.entries(member.env ?? {});
    if (envEntries.length > 0) {
      const envEl = createDiv("agent-params", configEl);
      envEl.dataset.prop = "env";
      createDiv({ cls: "agent-prop-label", text: STRINGS.properties.envSection, parent: envEl });
      for (const [key, value] of envEntries) {
        const rowEl = createDiv("agent-param-row", envEl);
        createDiv({ cls: "agent-param-key", text: key, parent: rowEl });
        createDiv({ cls: "agent-param-value", text: value, parent: rowEl });
      }
      createDiv({ cls: "agent-view-hint", text: STRINGS.properties.envHint, parent: envEl });
    }

    createDiv({ cls: "agent-view-hint", text: STRINGS.properties.configHint, parent: configEl });
  }

  private textRow(
    parentEl: HTMLElement,
    key: string,
    label: string,
    value: string,
    readOnly: boolean,
    commit: (value: string) => void,
    placeholder?: string,
  ): void {
    const rowEl = createDiv("agent-prop", parentEl);
    rowEl.dataset.prop = key;
    createDiv({ cls: "agent-prop-label", text: label, parent: rowEl });
    const input = createEl("input", { cls: "agent-prop-input", parent: rowEl });
    input.type = "text";
    if (placeholder) input.placeholder = placeholder;
    input.value = value;
    input.disabled = readOnly;
    input.addEventListener("change", () => commit(input.value.trim()));
  }

  // Upsert with env stripped: masked values must never round-trip, and an
  // absent env means "keep what is stored". The kernel's {error} text is
  // the user guidance (409 for file-origin, 400 for bad values).
  private async save(patch: Partial<KernelAgent>): Promise<void> {
    if (!this.member) return;
    const next = { ...this.member, ...patch };
    delete next.env;
    try {
      await this.transport.putAgent(next);
      this.member = { ...this.member, ...patch };
      new Notice(STRINGS.notices.agentSaved);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
    this.render();
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
