/**
 * Input: ../../views/ItemView, ../../views/StreamMarkdownRenderer, ../../dom/dom, ../../ui/Icon, ../../ui/Notice, ../../ui/Popover, ../../views/workspace/WorkspaceLeaf, ./AgentService, @earendil-works/pi-agent-core, stream-markdown-parser
 * Output: AgentView
 * Pos: UI Layer - View templates
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import type { Agent, AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import { getMarkdown, parseMarkdownToStructure } from "stream-markdown-parser";
import { createDiv, createEl } from "../../dom/dom";
import { setIcon } from "../../ui/Icon";
import { Notice } from "../../ui/Notice";
import { setTooltip } from "../../ui/Popover";
import { ItemView } from "../../views/ItemView";
import { StreamMarkdownRenderer } from "../../views/StreamMarkdownRenderer";
import type { WorkspaceLeaf } from "../../views/workspace/WorkspaceLeaf";
import { AGENT_VIEW_TYPE, getAgentService } from "./AgentService";

interface AssistantEntry {
  el: HTMLElement;
  renderer: StreamMarkdownRenderer;
  markdown: ReturnType<typeof getMarkdown>;
}

/** Text carried by an agent message, whatever block shape it arrived in. */
function messageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        Boolean(block) && (block as { type?: string }).type === "text",
    )
    .map((block) => block.text)
    .join("");
}

/**
 * The chat surface over pi's Agent SDK.
 *
 * The view is a listener, not a loop: `Agent.subscribe` hands it pi's event
 * stream (`message_start` → `message_update`* → `message_end`, tool execution
 * events around them) and every DOM decision here follows from one of those
 * events. Assistant text goes through the shared `StreamMarkdownRenderer`, the
 * same tail-only renderer the streaming markdown pipeline already uses, so a
 * growing response only re-renders its last block.
 */
export class AgentView extends ItemView {
  private agent: Agent | null = null;
  private unsubscribe: (() => void) | null = null;
  private messagesEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendEl!: HTMLButtonElement;
  private assistant: AssistantEntry | null = null;
  private readonly toolRows = new Map<string, HTMLElement>();
  private running = false;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.addAction("lucide-plus", "New chat", () => this.reset());
  }

  getViewType(): string {
    return AGENT_VIEW_TYPE;
  }
  getDisplayText(): string {
    return "Agent";
  }
  getIcon(): string {
    return "lucide-messages-square";
  }

  override async onOpen(): Promise<void> {
    this.contentEl.classList.add("agent-view");
    this.messagesEl = createDiv("agent-messages", this.contentEl);
    const composerEl = createDiv("agent-composer", this.contentEl);
    this.inputEl = createEl("textarea", "agent-composer-input", composerEl);
    this.inputEl.rows = 3;
    this.inputEl.placeholder = "Ask about your vault…";
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      void this.submit();
    });
    this.sendEl = createEl("button", "agent-composer-send mod-cta", composerEl);
    this.updateSendButton();
    this.sendEl.addEventListener("click", () => {
      if (this.running) this.agent?.abort();
      else void this.submit();
    });
    this.renderEmptyState();
  }

  override async onClose(): Promise<void> {
    this.agent?.abort();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.agent = null;
  }

  /** Drops the transcript and the Agent with it — a new Agent is the SDK's own
   * way to start a conversation, and it re-reads the model and system prompt
   * from settings on the way. */
  reset(): void {
    this.agent?.abort();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.agent = null;
    this.assistant = null;
    this.toolRows.clear();
    this.running = false;
    this.updateSendButton();
    this.messagesEl.replaceChildren();
    this.renderEmptyState();
  }

  private renderEmptyState(): void {
    const emptyEl = createDiv("agent-empty", this.messagesEl);
    const service = getAgentService(this.app);
    const settings = service.getSettings();
    emptyEl.textContent = `${settings.model} · reads and writes this vault through tools`;
  }

  private async ensureAgent(): Promise<Agent | null> {
    if (this.agent) return this.agent;
    try {
      // The SDK loads on first send, so this await is a real one exactly once
      // per view; a second caller arriving mid-load shares the same import.
      const agent = await getAgentService(this.app).createAgent();
      this.unsubscribe = agent.subscribe((event) => this.onAgentEvent(event));
      this.agent = agent;
      return agent;
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  private async submit(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (text === "" || this.running) return;
    const agent = await this.ensureAgent();
    if (!agent) return;
    this.inputEl.value = "";
    this.messagesEl.querySelector(".agent-empty")?.remove();
    await agent.prompt(text);
  }

  private onAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      case "agent_start":
        this.running = true;
        this.updateSendButton();
        break;
      case "agent_end":
        this.running = false;
        this.updateSendButton();
        this.reportError();
        break;
      case "message_start":
        if (isRole(event.message, "user")) this.appendUserMessage(messageText(event.message));
        else if (isRole(event.message, "assistant")) this.startAssistant();
        break;
      case "message_update":
        this.updateAssistant(messageText(event.message), false);
        break;
      case "message_end":
        if (isRole(event.message, "assistant")) {
          this.updateAssistant(messageText(event.message), true);
          this.assistant = null;
        }
        break;
      case "tool_execution_start":
        this.appendToolRow(event.toolCallId, event.toolName, event.args);
        break;
      case "tool_execution_end":
        this.finishToolRow(event.toolCallId, event.isError);
        break;
      default:
        break;
    }
    this.scrollToBottom();
  }

  private reportError(): void {
    const message = this.agent?.state.errorMessage;
    if (message) new Notice(message);
  }

  private appendUserMessage(text: string): void {
    const el = createDiv("agent-message mod-user", this.messagesEl);
    el.textContent = text;
  }

  private startAssistant(): void {
    const el = createDiv("agent-message mod-assistant", this.messagesEl);
    this.assistant = {
      el,
      renderer: new StreamMarkdownRenderer(el, this),
      // One markdown-it instance per message: the parser keeps per-document
      // state, so a shared one would carry the previous reply's references in.
      markdown: getMarkdown(`agent-${this.messagesEl.childElementCount}`),
    };
  }

  private updateAssistant(text: string, final: boolean): void {
    if (!this.assistant) this.startAssistant();
    const entry = this.assistant;
    if (!entry) return;
    entry.renderer.update(parseMarkdownToStructure(text, entry.markdown, { final }));
  }

  private appendToolRow(toolCallId: string, toolName: string, args: unknown): void {
    // Tool rows belong to the assistant turn that called them, but they arrive
    // after its message element — appending to the transcript keeps the visual
    // order the same as the event order.
    const el = createDiv("agent-tool is-running", this.messagesEl);
    const iconEl = createDiv("agent-tool-icon", el);
    setIcon(iconEl, "lucide-wrench");
    const labelEl = createDiv("agent-tool-label", el);
    labelEl.textContent = toolName;
    const argsText = summarizeArgs(args);
    if (argsText) {
      const argsEl = createDiv("agent-tool-args", el);
      argsEl.textContent = argsText;
      setTooltip(el, argsText);
    }
    this.toolRows.set(toolCallId, el);
  }

  private finishToolRow(toolCallId: string, isError: boolean): void {
    const el = this.toolRows.get(toolCallId);
    if (!el) return;
    el.classList.remove("is-running");
    if (isError) el.classList.add("is-error");
    this.toolRows.delete(toolCallId);
  }

  private updateSendButton(): void {
    this.sendEl.textContent = this.running ? "Stop" : "Send";
    this.sendEl.classList.toggle("mod-warning", this.running);
  }

  private scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
}

function isRole(message: AgentMessage, role: "user" | "assistant"): boolean {
  return (message as { role?: string }).role === role;
}

function summarizeArgs(args: unknown): string {
  if (args === undefined || args === null) return "";
  if (typeof args !== "object") return String(args);
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) return "";
  return entries
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(", ");
}
