import { createDiv, createEl, createSpan } from "../../dom/dom";
import { Component } from "../../core/Component";
import { Notice } from "../../ui/Notice";

export interface ComposerAttachment {
  id: string;
  name: string;
  content: string;
}

let attachmentCounter = 0;

// Owns the composer's transient attachment state, the way arkloop's parent
// owns its attachment list: ChatComposer composes this bar and reads it at
// submit; no attachment state lives inside ChatComposer itself.
export class ChatAttachmentBar extends Component {
  readonly el: HTMLElement;
  private readonly attachments = new Map<string, ComposerAttachment>();

  constructor(parentEl: HTMLElement) {
    super();
    this.el = createDiv("chat-attachment-bar", parentEl);
    this.el.hide();
  }

  isEmpty(): boolean {
    return this.attachments.size === 0;
  }

  addText(name: string, content: string): void {
    const id = `attachment-${++attachmentCounter}`;
    this.attachments.set(id, { id, name, content });
    this.render();
  }

  addFile(file: File): void {
    if (file.type.startsWith("image/")) {
      new Notice("Images are not supported yet");
      return;
    }
    void file.text().then((content) => this.addText(file.name, content));
  }

  list(): ComposerAttachment[] {
    return [...this.attachments.values()];
  }

  clear(): void {
    this.attachments.clear();
    this.render();
  }

  private remove(id: string): void {
    this.attachments.delete(id);
    this.render();
  }

  private render(): void {
    this.el.empty();
    this.el.toggle(this.attachments.size > 0);
    for (const attachment of this.attachments.values()) {
      const cardEl = createDiv("chat-attachment-card", this.el);
      createSpan({ cls: "chat-attachment-name", text: attachment.name, parent: cardEl });
      createSpan({
        cls: "chat-attachment-meta",
        text: `${attachment.content.split("\n").length} lines`,
        parent: cardEl,
      });
      const removeEl = createEl("button", { cls: "chat-attachment-remove", parent: cardEl, title: "Remove" });
      removeEl.setText("×");
      removeEl.addEventListener("click", () => this.remove(attachment.id));
    }
  }
}
