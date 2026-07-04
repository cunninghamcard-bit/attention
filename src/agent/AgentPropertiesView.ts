import { createDiv, createEl } from "../dom/dom";
import { AgentTransport, type AgentProfile } from "./AgentTransport";
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
  private readonly transport = new AgentTransport();
  // The agent's frontmatter, fetched from the bridge; edits PATCH back the
  // full profile (params replace wholesale, so removals stick).
  private profile: AgentProfile = {};
  private efforts: string[] = [];

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
    void this.transport.getAgent(agentId).then((summary) => {
      if (summary?.profile) {
        this.profile = summary.profile;
        this.render();
      }
    });
    void this.transport.listModels().then(({ efforts }) => {
      if (efforts.length > 0) {
        this.efforts = efforts;
        this.render();
      }
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
    this.prop(statusEl, "state", STRINGS.properties.state, state.running ? STRINGS.agentState.running : STRINGS.agentState.idle);
    if (state.lastError) this.prop(statusEl, "error", STRINGS.properties.lastError, state.lastError);

    const activityEl = this.section(rootEl, "activity", STRINGS.properties.activity);
    this.prop(activityEl, "messages", STRINGS.properties.messages, String(state.messages.length));
    this.prop(activityEl, "compactions", STRINGS.properties.compactions, String(state.compactions.length));
    if (state.usage) this.prop(activityEl, "usage", STRINGS.properties.lastRun, formatUsage(state.usage));

    this.renderConfig(rootEl);

    const actionsEl = this.section(rootEl, "actions", STRINGS.properties.actions);
    const openEl = createEl("button", { cls: "agent-view-action", text: STRINGS.properties.openChat, parent: actionsEl });
    openEl.addEventListener("click", () => void openAgent(this.app, this.agentId));
  }

  // The frontmatter editor: known fields (model, effort) as typed inputs,
  // open params as key/value rows — the same two-tier shape a note's
  // properties panel has.
  private renderConfig(rootEl: HTMLElement): void {
    const configEl = this.section(rootEl, "config", STRINGS.properties.configuration);

    const modelRow = createDiv("agent-prop", configEl);
    modelRow.dataset.prop = "model";
    createDiv({ cls: "agent-prop-label", text: STRINGS.properties.model, parent: modelRow });
    const modelInput = createEl("input", { cls: "agent-prop-input", parent: modelRow });
    modelInput.type = "text";
    modelInput.placeholder = STRINGS.properties.modelPlaceholder;
    modelInput.value = this.profile.model ?? "";
    modelInput.addEventListener("change", () => {
      this.profile.model = modelInput.value.trim() || undefined;
      void this.saveProfile();
    });

    const effortRow = createDiv("agent-prop", configEl);
    effortRow.dataset.prop = "effort";
    createDiv({ cls: "agent-prop-label", text: STRINGS.properties.effort, parent: effortRow });
    const effortSelect = createEl("select", { cls: "agent-prop-input", parent: effortRow });
    for (const level of ["", ...(this.efforts.length > 0 ? this.efforts : ["low", "medium", "high"])]) {
      const option = createEl("option", { parent: effortSelect, text: level || STRINGS.properties.effortDefault });
      option.value = level;
    }
    effortSelect.value = this.profile.effort ?? "";
    effortSelect.addEventListener("change", () => {
      this.profile.effort = effortSelect.value || undefined;
      void this.saveProfile();
    });

    this.stepperRow(configEl, "temperature", STRINGS.properties.temperature, 0.1, 0, 2, () => this.profile.temperature, (value) => (this.profile.temperature = value));
    this.stepperRow(configEl, "maxTokens", STRINGS.properties.maxTokens, 128, 1, 1_000_000, () => this.profile.maxTokens, (value) => (this.profile.maxTokens = value));

    const paramsEl = createDiv("agent-params", configEl);
    paramsEl.dataset.prop = "params";
    createDiv({ cls: "agent-prop-label", text: STRINGS.properties.params, parent: paramsEl });
    for (const [key, value] of Object.entries(this.profile.params ?? {})) this.paramRow(paramsEl, key, value);
    const addEl = createEl("button", { cls: "agent-param-add", text: STRINGS.properties.addParam, parent: paramsEl });
    addEl.addEventListener("click", () => this.paramRow(paramsEl, "", "", addEl));

    createDiv({ cls: "agent-view-hint", text: STRINGS.properties.configHint, parent: configEl });
  }

  private paramRow(parentEl: HTMLElement, key: string, value: string, beforeEl?: HTMLElement): void {
    const rowEl = createDiv("agent-param-row", parentEl);
    if (beforeEl) parentEl.insertBefore(rowEl, beforeEl);
    const keyInput = createEl("input", { cls: "agent-param-key", parent: rowEl });
    keyInput.type = "text";
    keyInput.placeholder = STRINGS.properties.paramKey;
    keyInput.value = key;
    const valueInput = createEl("input", { cls: "agent-param-value", parent: rowEl });
    valueInput.type = "text";
    valueInput.placeholder = STRINGS.properties.paramValue;
    valueInput.value = value;
    const removeEl = createEl("button", { cls: "agent-param-remove", text: "×", parent: rowEl });
    const commit = () => void this.saveParams();
    keyInput.addEventListener("change", commit);
    valueInput.addEventListener("change", commit);
    removeEl.addEventListener("click", () => {
      rowEl.remove();
      void this.saveParams();
    });
  }

  // Params are read back from the DOM rows so add/edit/remove share one path.
  private async saveParams(): Promise<void> {
    const params: Record<string, string> = {};
    for (const rowEl of this.contentEl.querySelectorAll(".agent-param-row")) {
      const key = (rowEl.querySelector(".agent-param-key") as HTMLInputElement).value.trim();
      const value = (rowEl.querySelector(".agent-param-value") as HTMLInputElement).value;
      if (key) params[key] = value;
    }
    this.profile.params = params;
    await this.saveProfile();
  }

  // Numeric dials PATCH through a debounce accumulator (DeepChat's
  // pendingGenerationPatch shape) so steppers don't fire one request per
  // click burst.
  private saveTimer = 0;

  private saveProfileDebounced(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.saveProfile(), 500);
  }

  private stepperRow(
    parentEl: HTMLElement,
    key: string,
    label: string,
    step: number,
    min: number,
    max: number,
    read: () => number | undefined,
    write: (value: number | undefined) => void,
  ): void {
    const rowEl = createDiv("agent-prop", parentEl);
    rowEl.dataset.prop = key;
    createDiv({ cls: "agent-prop-label", text: label, parent: rowEl });
    const stepperEl = createDiv("agent-prop-stepper", rowEl);
    const decEl = createEl("button", { text: "−", parent: stepperEl });
    const input = createEl("input", { cls: "agent-prop-input", parent: stepperEl });
    input.type = "text";
    input.placeholder = STRINGS.properties.effortDefault;
    input.value = read() !== undefined ? String(read()) : "";
    const incEl = createEl("button", { text: "+", parent: stepperEl });
    const clamp = (value: number) => Math.min(max, Math.max(min, Math.round(value * 1000) / 1000));
    const commit = (value: number | undefined) => {
      write(value);
      input.value = value !== undefined ? String(value) : "";
      this.saveProfileDebounced();
    };
    decEl.addEventListener("click", () => commit(clamp((read() ?? (key === "temperature" ? 1 : 4096)) - step)));
    incEl.addEventListener("click", () => commit(clamp((read() ?? (key === "temperature" ? 1 : 4096)) + step)));
    input.addEventListener("change", () => {
      const parsed = Number(input.value.trim());
      commit(input.value.trim() === "" || !Number.isFinite(parsed) ? undefined : clamp(parsed));
    });
  }

  private async saveProfile(): Promise<void> {
    await this.transport.updateProfile(this.agentId, this.profile);
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
