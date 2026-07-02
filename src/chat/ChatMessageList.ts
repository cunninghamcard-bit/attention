import { getMarkdown, parseMarkdownToStructure } from "stream-markdown-parser";
import { createDiv, createEl, createSpan } from "../dom/dom";
import { Component } from "../core/Component";
import { getChatToolRenderer } from "./ChatRegistry";
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

  sync(part: ChatPart): void {
    const signature = this.signatureOf(part);
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    if (part.type === "tool") this.syncTool(part);
    else this.syncText(part);
  }

  private signatureOf(part: ChatPart): string {
    if (part.type === "tool") return `tool:${part.closed}:${part.input.length}:${part.result?.length ?? -1}`;
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
    if (part.input) createEl("pre", { cls: "chat-tool-input", text: part.input, parent: this.el });
    if (part.result !== undefined) createEl("pre", { cls: "chat-tool-result", text: part.result, parent: this.el });
  }
}

class ChatMessageItem extends Component {
  readonly el: HTMLElement;
  private readonly partsEl: HTMLElement;
  private readonly partRenderers: ChatPartRenderer[] = [];

  constructor(parentEl: HTMLElement, private readonly message: ChatMessage) {
    super();
    this.el = createDiv(`chat-message chat-message-${message.role}`, parentEl);
    createDiv({ cls: "chat-message-role", text: message.role === "user" ? "You" : "Assistant", parent: this.el });
    this.partsEl = createDiv("chat-message-parts", this.el);
  }

  sync(): void {
    for (let index = 0; index < this.message.parts.length; index++) {
      const part = this.message.parts[index];
      if (!part) continue;
      let renderer = this.partRenderers[index];
      if (!renderer) {
        renderer = this.addChild(new ChatPartRenderer(this.partsEl, this.message.id, index));
        this.partRenderers[index] = renderer;
      }
      renderer.sync(part);
    }
    this.el.toggleClass("is-closed", this.message.closed);
  }
}

// Completed turns render once and go quiescent; only the open tail message
// keeps updating. The live turn is not a separate pane: each item stops
// changing the moment its message closes, so the DOM hands itself off.
export class ChatMessageList extends Component {
  readonly el: HTMLElement;
  private readonly items = new Map<string, ChatMessageItem>();

  constructor(parentEl: HTMLElement, private readonly session: ChatSession) {
    super();
    this.el = createDiv("chat-message-list", parentEl);
  }

  sync(): void {
    for (const message of this.session.getMessages()) {
      let item = this.items.get(message.id);
      if (!item) {
        item = this.addChild(new ChatMessageItem(this.el, message));
        this.items.set(message.id, item);
      }
      item.sync();
    }
  }
}
