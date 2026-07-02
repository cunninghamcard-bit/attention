import { getMarkdown, parseMarkdownToStructure } from "stream-markdown-parser";
import { createDiv, createEl, createSpan } from "../dom/dom";
import { Component } from "../core/Component";
import { getChatToolRenderer, listChatMessageActions } from "./ChatRegistry";
import type { ChatMessage, ChatPart, ChatSession, ToolChatPart } from "./ChatSession";
import { StreamMarkdownRenderer } from "./StreamMarkdownRenderer";

class ChatPartRenderer extends Component {
  readonly el: HTMLElement;
  private renderer: StreamMarkdownRenderer | null = null;
  private lastSignature = "";

  constructor(
    parentEl: HTMLElement,
    private readonly messageId: string,
    private readonly partIndex: number,
  ) {
    super();
    this.el = createDiv("chat-part", parentEl);
  }

  private applyDataAttributes(part: ChatPart): void {
    this.el.dataset.partType = part.type;
    if (part.type === "tool") this.el.dataset.toolName = part.toolName;
    else delete this.el.dataset.toolName;
  }

  sync(part: ChatPart): void {
    const signature = this.signatureOf(part);
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.applyDataAttributes(part);
    if (part.type === "tool") this.syncTool(part);
    else if (part.type === "attachment") this.syncAttachment(part);
    else this.syncText(part);
  }

  private syncAttachment(part: Extract<ChatPart, { type: "attachment" }>): void {
    this.el.className = "chat-part chat-part-attachment";
    this.el.empty();
    const headerEl = createDiv("chat-attachment-header", this.el);
    createSpan({ cls: "chat-attachment-name", text: part.name, parent: headerEl });
    createSpan({ cls: "chat-attachment-meta", text: `${part.content.split("\n").length} lines`, parent: headerEl });
    createEl("pre", { cls: "chat-attachment-content", text: part.content, parent: this.el });
  }

  private signatureOf(part: ChatPart): string {
    if (part.type === "tool") return `tool:${part.closed}:${part.input.length}:${part.result?.length ?? -1}`;
    if (part.type === "attachment") return `attachment:${part.closed}:${part.content.length}`;
    return `${part.type}:${part.closed}:${part.markdown.length}`;
  }

  private syncText(part: Extract<ChatPart, { type: "text" | "thinking" }>): void {
    this.el.className = part.type === "thinking" ? "chat-part chat-part-thinking" : "chat-part chat-part-text";
    if (!this.renderer) this.renderer = new StreamMarkdownRenderer(this.el, this, `chat://${this.messageId}/${this.partIndex}`);
    const md = getMarkdown(`${this.messageId}:${this.partIndex}`);
    const nodes = parseMarkdownToStructure(part.markdown, md, part.closed ? { final: true } : undefined);
    this.renderer.update(nodes);
    this.el.toggleClass("is-streaming", !part.closed);
  }

  private toolExpanded = false;

  private syncTool(part: ToolChatPart): void {
    this.el.className = "chat-part chat-part-tool";
    this.el.empty();
    const custom = getChatToolRenderer(part.toolName);
    if (custom) {
      custom.render(part, this.el, { component: this });
      return;
    }
    const headerEl = createDiv("chat-tool-header", this.el);
    createSpan({ cls: "chat-tool-name", text: part.toolName, parent: headerEl });
    createSpan({
      cls: `chat-tool-status ${part.closed ? "is-done" : "is-running"}`,
      text: part.closed ? (part.result !== undefined ? "done" : "called") : "running",
      parent: headerEl,
    });
    // Rows stay compact once done; the details expand on click, and stay
    // open live so the running call's input streams in view.
    const detailsEl = createDiv("chat-tool-details", this.el);
    if (part.input) createEl("pre", { cls: "chat-tool-input", text: part.input, parent: detailsEl });
    if (part.result !== undefined) createEl("pre", { cls: "chat-tool-result", text: part.result, parent: detailsEl });
    detailsEl.toggle(!part.closed || this.toolExpanded);
    headerEl.addEventListener("click", () => {
      this.toolExpanded = !this.toolExpanded;
      detailsEl.toggle(!part.closed || this.toolExpanded);
    });
  }
}

interface ToolTimeline {
  el: HTMLElement;
  headerTextEl: HTMLElement;
  bodyEl: HTMLElement;
  partIndexes: number[];
  userToggled: boolean;
  autoCollapsed: boolean;
}

class ChatMessageItem extends Component {
  readonly el: HTMLElement;
  private readonly partsEl: HTMLElement;
  private readonly partRenderers: ChatPartRenderer[] = [];
  private readonly timelines = new Map<number, ToolTimeline>();

  constructor(parentEl: HTMLElement, private readonly message: ChatMessage) {
    super();
    this.el = createDiv(`chat-message chat-message-${message.role}`, parentEl);
    this.el.dataset.role = message.role;
    this.el.dataset.messageId = message.id;
    const headerEl = createDiv("chat-message-header", this.el);
    createDiv({ cls: "chat-message-role", text: message.role === "user" ? "You" : "Assistant", parent: headerEl });
    const actionsEl = createDiv("chat-message-actions", headerEl);
    for (const action of listChatMessageActions()) {
      const buttonEl = createEl("button", { cls: "chat-message-action", parent: actionsEl, title: action.title });
      buttonEl.setText(action.title.toLowerCase());
      buttonEl.addEventListener("click", () => action.run(this.message));
    }
    this.partsEl = createDiv("chat-message-parts", this.el);
  }

  sync(): void {
    for (let index = 0; index < this.message.parts.length; index++) {
      const part = this.message.parts[index];
      if (!part) continue;
      let renderer = this.partRenderers[index];
      if (!renderer) {
        const parentEl = part.type === "tool" ? this.timelineFor(index).bodyEl : this.partsEl;
        renderer = this.addChild(new ChatPartRenderer(parentEl, this.message.id, index));
        this.partRenderers[index] = renderer;
      }
      renderer.sync(part);
    }
    this.syncTimelines();
    this.el.toggleClass("is-closed", this.message.closed);
  }

  // Consecutive tool parts share one timeline: the run's activity reads as
  // one collapsible unit instead of flooding the conversation.
  private timelineFor(index: number): ToolTimeline {
    const previous = index > 0 ? this.timelines.get(index - 1) : undefined;
    if (previous && this.message.parts[index - 1]?.type === "tool") {
      previous.partIndexes.push(index);
      this.timelines.set(index, previous);
      return previous;
    }
    const el = createDiv("chat-tool-timeline", this.partsEl);
    const headerEl = createDiv("chat-tool-timeline-header", el);
    const headerTextEl = createSpan({ cls: "chat-tool-timeline-summary", parent: headerEl });
    const bodyEl = createDiv("chat-tool-timeline-body", el);
    const timeline: ToolTimeline = { el, headerTextEl, bodyEl, partIndexes: [index], userToggled: false, autoCollapsed: false };
    headerEl.addEventListener("click", () => {
      timeline.userToggled = true;
      el.toggleClass("is-collapsed", !el.hasClass("is-collapsed"));
    });
    this.timelines.set(index, timeline);
    return timeline;
  }

  private syncTimelines(): void {
    for (const timeline of new Set(this.timelines.values())) {
      const parts = timeline.partIndexes.map((index) => this.message.parts[index]).filter(Boolean);
      const total = parts.length;
      const running = parts.some((part) => !part.closed);
      timeline.headerTextEl.setText(`${total} tool call${total === 1 ? "" : "s"} · ${running ? "running" : "done"}`);
      timeline.el.toggleClass("is-running", running);
      if (!running && !timeline.userToggled && !timeline.autoCollapsed) {
        timeline.autoCollapsed = true;
        timeline.el.addClass("is-collapsed");
      }
    }
  }
}

// Completed turns render once and go quiescent; only the open tail message
// keeps updating. The live turn is not a separate pane: each item stops
// changing the moment its message closes, so the DOM hands itself off.
export class ChatMessageList extends Component {
  readonly el: HTMLElement;
  private readonly items = new Map<string, ChatMessageItem>();
  private readonly emptyEl: HTMLElement;
  private readonly thinkingEl: HTMLElement;

  constructor(parentEl: HTMLElement, private readonly session: ChatSession) {
    super();
    this.el = createDiv("chat-message-list", parentEl);
    this.emptyEl = createDiv("chat-empty", this.el);
    createDiv({ cls: "chat-empty-title", text: "Start a conversation", parent: this.emptyEl });
    createDiv({ cls: "chat-empty-hint", text: "Type a message below, or / for commands.", parent: this.emptyEl });
    this.thinkingEl = createDiv("chat-thinking-indicator", this.el);
    for (let index = 0; index < 3; index++) createSpan({ cls: "chat-thinking-dot", parent: this.thinkingEl });
    this.thinkingEl.hide();
  }

  sync(): void {
    const messages = this.session.getMessages();
    this.emptyEl.toggle(messages.length === 0);
    for (const message of messages) {
      let item = this.items.get(message.id);
      if (!item) {
        item = this.addChild(new ChatMessageItem(this.el, message));
        this.items.set(message.id, item);
        this.el.appendChild(this.thinkingEl);
      }
      item.sync();
    }
    const last = messages[messages.length - 1];
    const waiting = this.session.isRunning() && (!last || last.role === "user" || last.closed);
    this.thinkingEl.toggle(waiting);
  }
}
