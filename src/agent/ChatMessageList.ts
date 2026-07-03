import { getMarkdown, parseMarkdownToStructure } from "stream-markdown-parser";
import { createDiv, createEl, createSpan } from "../dom/dom";
import { Component } from "../core/Component";
import { Collapse } from "../ui/Collapse";
import { getChatToolRenderer, listChatMessageActions } from "./ChatRegistry";
import type { ChatMessage, ChatPart, Agent, TextChatPart, ToolChatPart } from "./Agent";
import { STRINGS, timeGreeting } from "./AgentStrings";
import { createStatusDot, setStatusDot } from "./StatusDot";
import { StreamMarkdownRenderer } from "../views/StreamMarkdownRenderer";
import { Typewriter } from "../views/Typewriter";

// Typewriter reveals grow content between agent events, outside the view's
// sync cycle — this hook lets the scroller follow that growth.
export type ChatContentGrowCallback = () => void;

// User preferences, read at use sites the way the paste threshold is; the
// setting tab writes the same keys ("off" = disabled, absent = default on).
function typewriterEnabled(): boolean {
  try {
    return window.localStorage?.getItem("chat-typewriter") !== "off";
  } catch {
    return true;
  }
}

function autoCollapseThinking(): boolean {
  try {
    return window.localStorage?.getItem("chat-thinking-collapse") !== "off";
  } catch {
    return true;
  }
}

// A stable hue per author id: multi-agent conversations become scannable by
// color without any roster configuration. Same trick avatars everywhere use.
export function authorHue(authorId: string): number {
  let hash = 0;
  for (let index = 0; index < authorId.length; index++) hash = (hash * 31 + authorId.charCodeAt(index)) | 0;
  return Math.abs(hash) % 360;
}

class ChatPartRenderer extends Component {
  readonly el: HTMLElement;
  private renderer: StreamMarkdownRenderer | null = null;
  private typewriter: Typewriter | null = null;
  private lastSignature = "";

  constructor(
    parentEl: HTMLElement,
    private readonly messageId: string,
    private readonly partIndex: number,
    private readonly onGrow?: ChatContentGrowCallback,
  ) {
    super();
    this.el = createDiv("chat-part", parentEl);
  }

  override onunload(): void {
    this.typewriter?.destroy();
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
    createSpan({ cls: "chat-attachment-meta", text: STRINGS.message.attachmentLines(part.content.split("\n").length), parent: headerEl });
    createEl("pre", { cls: "chat-attachment-content", text: part.content, parent: this.el });
  }

  private signatureOf(part: ChatPart): string {
    if (part.type === "tool") return `tool:${part.closed}:${part.input.length}:${part.result?.length ?? -1}:${part.error?.length ?? -1}`;
    if (part.type === "attachment") return `attachment:${part.closed}:${part.content.length}`;
    return `${part.type}:${part.closed}:${part.markdown.length}`;
  }

  private thinkingCollapse: Collapse | null = null;
  private thinkingPart: TextChatPart | null = null;
  private thinkingTimer = 0;

  private syncText(part: Extract<ChatPart, { type: "text" | "thinking" }>): void {
    if (part.type === "thinking") return this.syncThinking(part);
    this.el.classList.add("chat-part-text");
    this.ensureMarkdownTarget(this.el);
    if (!typewriterEnabled()) return this.renderMarkdown(part.markdown, part.closed);
    this.typewriter!.setTarget(part.markdown, part.closed);
  }

  // Thinking renders as a collapsible card: open with a shimmering header
  // and a live elapsed clock while it streams, folded to "Thought · 3.2s"
  // once it closes — reasoning stays reachable without dominating the
  // transcript.
  private syncThinking(part: Extract<ChatPart, { type: "text" | "thinking" }>): void {
    this.el.classList.add("chat-part-thinking");
    this.thinkingPart = part;
    if (!this.thinkingCollapse) {
      this.thinkingCollapse = new Collapse(this.el, { header: "chat-thinking-header", clip: "chat-thinking-clip", body: "chat-thinking-body" });
    }
    if (!this.thinkingCollapse.userToggled) this.thinkingCollapse.setCollapsed(part.closed && autoCollapseThinking());
    this.updateThinkingHeader();
    // The clock ticks between deltas too, so a silent engine still reads as
    // alive; the interval dies with the component or the part's close.
    if (!part.closed && !this.thinkingTimer) {
      this.thinkingTimer = window.setInterval(() => this.updateThinkingHeader(), 1000);
      this.registerInterval(this.thinkingTimer);
    } else if (part.closed && this.thinkingTimer) {
      window.clearInterval(this.thinkingTimer);
      this.thinkingTimer = 0;
    }
    this.ensureMarkdownTarget(this.thinkingCollapse.bodyEl);
    if (!typewriterEnabled()) return this.renderMarkdown(part.markdown, part.closed);
    this.typewriter!.setTarget(part.markdown, part.closed);
  }

  private updateThinkingHeader(): void {
    const part = this.thinkingPart;
    if (!part || !this.thinkingCollapse) return;
    const elapsed = part.openedAt ? ((part.closedAt ?? Date.now()) - part.openedAt) / 1000 : null;
    this.thinkingCollapse.headerEl.setText(part.closed ? STRINGS.thinking.done(elapsed) : STRINGS.thinking.active(elapsed));
  }

  private ensureMarkdownTarget(parentEl: HTMLElement): void {
    if (!this.renderer) this.renderer = new StreamMarkdownRenderer(parentEl, this, `agent://${this.messageId}/${this.partIndex}`);
    if (!this.typewriter) this.typewriter = new Typewriter((visible, done) => this.renderMarkdown(visible, done));
  }

  private renderMarkdown(visible: string, done: boolean): void {
    const md = getMarkdown(`${this.messageId}:${this.partIndex}`);
    const nodes = parseMarkdownToStructure(visible, md, done ? { final: true } : undefined);
    this.renderer!.update(nodes);
    this.el.toggleClass("is-streaming", !done);
    this.onGrow?.();
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
    const failed = part.error !== undefined;
    this.el.toggleClass("is-failed", failed);
    const headerEl = createDiv("chat-tool-header", this.el);
    createSpan({ cls: "chat-tool-name", text: part.toolName, parent: headerEl });
    createSpan({
      cls: `chat-tool-status ${failed ? "is-failed" : part.closed ? "is-done" : "is-running"}`,
      text: failed ? STRINGS.tool.failed : part.closed ? (part.result !== undefined ? STRINGS.tool.done : STRINGS.tool.called) : STRINGS.tool.running,
      parent: headerEl,
    });
    // Rows stay compact once done; the details expand on click, and stay
    // open live so the running call's input streams in view. Failures stay
    // open so the error is never hidden behind a click.
    if (failed) this.toolExpanded = true;
    const detailsEl = createDiv("chat-tool-details", this.el);
    if (part.input) createEl("pre", { cls: "chat-tool-input", text: part.input, parent: detailsEl });
    if (failed) createEl("pre", { cls: "chat-tool-error", text: part.error, parent: detailsEl });
    else if (part.result !== undefined) createEl("pre", { cls: "chat-tool-result", text: part.result, parent: detailsEl });
    detailsEl.toggle(!part.closed || this.toolExpanded);
    headerEl.addEventListener("click", () => {
      this.toolExpanded = !this.toolExpanded;
      detailsEl.toggle(!part.closed || this.toolExpanded);
    });
  }
}

interface ToolTimeline {
  collapse: Collapse;
  dotEl: HTMLElement;
  headerTextEl: HTMLElement;
  partIndexes: number[];
  autoCollapsed: boolean;
}

class ChatMessageItem extends Component {
  readonly el: HTMLElement;
  private readonly partsEl: HTMLElement;
  private readonly partRenderers: ChatPartRenderer[] = [];
  private readonly timelines = new Map<number, ToolTimeline>();

  constructor(
    parentEl: HTMLElement,
    private readonly message: ChatMessage,
    private readonly session: Agent,
    private readonly onGrow?: ChatContentGrowCallback,
  ) {
    super();
    this.el = createDiv(`chat-message chat-message-${message.role}`, parentEl);
    this.el.dataset.role = message.role;
    this.el.dataset.messageId = message.id;
    if (message.authorId) {
      this.el.dataset.authorId = message.authorId;
      this.el.style.setProperty("--author-hue", String(authorHue(message.authorId)));
    }
    // No role labels — the bubble side already says who is talking (the
    // ArkLoop rule). Only a room's author name earns a header line.
    if (message.role === "assistant" && message.authorName) {
      const headerEl = createDiv("chat-message-header", this.el);
      createDiv({ cls: "chat-message-role", text: message.authorName, parent: headerEl });
    }
    this.partsEl = createDiv("chat-message-parts", this.el);
    const actionsEl = createDiv("chat-message-actions", this.el);
    for (const action of listChatMessageActions()) {
      if (action.appliesTo && !action.appliesTo(message)) continue;
      const buttonEl = createEl("button", { cls: "chat-message-action", parent: actionsEl, title: action.title });
      buttonEl.setText(action.title.toLowerCase());
      buttonEl.addEventListener("click", () => {
        action.run(this.message, { agent: this.session });
        // ArkLoop-style feedback: the button itself confirms, briefly.
        buttonEl.setText("✓");
        window.setTimeout(() => buttonEl.setText(action.title.toLowerCase()), 900);
      });
    }
  }

  sync(): void {
    for (let index = 0; index < this.message.parts.length; index++) {
      const part = this.message.parts[index];
      if (!part) continue;
      let renderer = this.partRenderers[index];
      if (!renderer) {
        const parentEl = part.type === "tool" ? this.timelineFor(index).collapse.bodyEl : this.partsEl;
        renderer = this.addChild(new ChatPartRenderer(parentEl, this.message.id, index, this.onGrow));
        this.partRenderers[index] = renderer;
      }
      renderer.sync(part);
    }
    this.syncTimelines();
    this.el.toggleClass("is-closed", this.message.closed);
    this.syncUserCollapse();
  }

  // Long user messages fold to a preview with a fade mask — the question is
  // context, not the content being read. Measured once; user messages arrive
  // closed and never grow.
  private showMoreEl: HTMLElement | null = null;

  private syncUserCollapse(): void {
    if (this.message.role !== "user" || this.showMoreEl || !this.message.closed) return;
    if (this.partsEl.scrollHeight <= 220) return;
    this.el.addClass("is-collapsible");
    this.showMoreEl = createEl("button", { cls: "chat-show-more", text: STRINGS.message.showMore, parent: this.el });
    this.showMoreEl.addEventListener("click", () => {
      const expanded = this.el.hasClass("is-expanded");
      this.el.toggleClass("is-expanded", !expanded);
      this.showMoreEl!.setText(expanded ? STRINGS.message.showMore : STRINGS.message.showLess);
    });
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
    const collapse = new Collapse(el, { header: "chat-tool-timeline-header", clip: "chat-tool-timeline-clip", body: "chat-tool-timeline-body" });
    const dotEl = createStatusDot(collapse.headerEl, "running");
    const headerTextEl = createSpan({ cls: "chat-tool-timeline-summary", parent: collapse.headerEl });
    const timeline: ToolTimeline = { collapse, dotEl, headerTextEl, partIndexes: [index], autoCollapsed: false };
    this.timelines.set(index, timeline);
    return timeline;
  }

  private syncTimelines(): void {
    for (const timeline of new Set(this.timelines.values())) {
      const parts = timeline.partIndexes.map((index) => this.message.parts[index]).filter(Boolean);
      const total = parts.length;
      const running = parts.some((part) => !part.closed);
      const failedCount = parts.filter((part) => part.type === "tool" && part.error !== undefined).length;
      const opened = parts[0]?.openedAt;
      const closed = parts[parts.length - 1]?.closedAt;
      const duration = !running && opened && closed && closed > opened ? (closed - opened) / 1000 : null;
      const status = running ? STRINGS.tool.running : failedCount ? STRINGS.timeline.failedStatus(failedCount) : STRINGS.tool.done;
      timeline.headerTextEl.setText(STRINGS.timeline.summary(total, status, duration));
      setStatusDot(timeline.dotEl, running ? "running" : failedCount ? "failed" : "done");
      timeline.collapse.rootEl.toggleClass("is-running", running);
      timeline.collapse.rootEl.toggleClass("has-failed", failedCount > 0);
      // Failures keep the timeline open; a fully green run tucks itself away.
      if (!running && failedCount === 0 && !timeline.collapse.userToggled && !timeline.autoCollapsed) {
        timeline.autoCollapsed = true;
        timeline.collapse.setCollapsed(true);
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

  constructor(
    parentEl: HTMLElement,
    private readonly session: Agent,
    private readonly onGrow?: ChatContentGrowCallback,
  ) {
    super();
    this.el = createDiv("chat-message-list", parentEl);
    this.emptyEl = createDiv("chat-empty", this.el);
    createDiv({ cls: "chat-greeting", text: timeGreeting(), parent: this.emptyEl });
    this.thinkingEl = createDiv("chat-thinking-indicator", this.el);
    for (let index = 0; index < 3; index++) createSpan({ cls: "chat-thinking-dot", parent: this.thinkingEl });
    this.thinkingEl.hide();
    // Run errors are conversation history (run.closed status:error), so they
    // render in the stream — history replay shows them again, unlike a toast.
    this.errorEl = createDiv("chat-run-error", this.el);
    this.errorEl.hide();
  }

  private readonly errorEl: HTMLElement;

  private renderedCompactions = 0;

  sync(): void {
    const messages = this.session.getMessages();
    this.emptyEl.toggle(messages.length === 0);
    for (const message of messages) {
      let item = this.items.get(message.id);
      if (!item) {
        this.renderCompactionsAfter(messages[messages.indexOf(message) - 1]?.id ?? null);
        item = this.addChild(new ChatMessageItem(this.el, message, this.session, this.onGrow));
        this.items.set(message.id, item);
        this.el.appendChild(this.thinkingEl);
        this.el.appendChild(this.errorEl);
      }
      item.sync();
    }
    this.renderCompactionsAfter(messages[messages.length - 1]?.id ?? null);
    const last = messages[messages.length - 1];
    const waiting = this.session.isRunning() && (!last || last.role === "user" || last.closed);
    this.thinkingEl.toggle(waiting);
    const error = this.session.state.lastError;
    if (error) this.errorEl.setText(STRINGS.message.runFailed(error));
    this.errorEl.toggle(Boolean(error));
  }

  // Compaction dividers land between the message they follow and whatever
  // comes next; each marker renders exactly once, in event order.
  private renderCompactionsAfter(previousMessageId: string | null): void {
    const compactions = this.session.state.compactions;
    while (this.renderedCompactions < compactions.length) {
      const compaction = compactions[this.renderedCompactions];
      if (compaction.afterMessageId !== previousMessageId) return;
      this.renderedCompactions++;
      const dividerEl = createDiv("chat-compact-divider");
      const label = compaction.preTokens ? STRINGS.message.compactedTokens(compaction.preTokens) : STRINGS.message.compacted;
      createSpan({ cls: "chat-compact-label", text: label, parent: dividerEl });
      this.el.insertBefore(dividerEl, this.thinkingEl);
    }
  }
}
