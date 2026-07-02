import { createDiv, createEl, createSpan } from "../dom/dom";
import { Component } from "../core/Component";
import { listChatComposerActions, listChatSlashCommands, type ChatSlashCommand } from "./ChatRegistry";

export interface ChatComposerCallbacks {
  send(text: string): void;
  stop(): void;
  isRunning(): boolean;
}

export class ChatComposer extends Component {
  readonly el: HTMLElement;
  private readonly inputEl: HTMLTextAreaElement;
  private readonly sendButtonEl: HTMLButtonElement;
  private readonly suggestEl: HTMLElement;
  private suggestIndex = 0;

  constructor(parentEl: HTMLElement, private readonly callbacks: ChatComposerCallbacks) {
    super();
    this.el = createDiv("chat-composer", parentEl);
    this.suggestEl = createDiv("chat-slash-suggest", this.el);
    this.suggestEl.hide();
    const rowEl = createDiv("chat-composer-row", this.el);
    this.inputEl = createEl("textarea", { cls: "chat-composer-input", parent: rowEl, placeholder: "Message… (/ for commands)" });
    const actionsEl = createDiv("chat-composer-actions", rowEl);
    for (const action of listChatComposerActions()) {
      const buttonEl = createEl("button", { cls: "chat-composer-action", parent: actionsEl, text: action.title });
      buttonEl.addEventListener("click", () =>
        action.onClick({
          getValue: () => this.getValue(),
          setValue: (value) => this.setValue(value),
          send: () => this.submit(),
        }),
      );
    }
    this.sendButtonEl = createEl("button", { cls: "chat-composer-send mod-cta", parent: actionsEl, text: "Send" });
  }

  override onload(): void {
    this.registerDomEvent(this.inputEl, "input", () => this.updateSuggest());
    this.registerDomEvent(this.inputEl, "keydown", (event) => this.onKeyDown(event));
    this.registerDomEvent(this.sendButtonEl, "click", () => (this.callbacks.isRunning() ? this.callbacks.stop() : this.submit()));
  }

  getValue(): string {
    return this.inputEl.value;
  }

  setValue(value: string): void {
    this.inputEl.value = value;
    this.updateSuggest();
  }

  focus(): void {
    this.inputEl.focus();
  }

  syncRunning(): void {
    const running = this.callbacks.isRunning();
    this.sendButtonEl.setText(running ? "Stop" : "Send");
    this.sendButtonEl.toggleClass("is-running", running);
  }

  private submit(): void {
    const text = this.inputEl.value.trim();
    if (!text || this.callbacks.isRunning()) return;
    this.inputEl.value = "";
    this.updateSuggest();
    this.callbacks.send(text);
  }

  private matchingCommands(): ChatSlashCommand[] {
    const value = this.inputEl.value;
    if (!value.startsWith("/") || value.includes("\n")) return [];
    const query = value.slice(1).toLowerCase();
    return listChatSlashCommands().filter(
      (command) => command.id.toLowerCase().startsWith(query) || command.name.toLowerCase().includes(query),
    );
  }

  private updateSuggest(): void {
    const commands = this.matchingCommands();
    this.suggestEl.empty();
    if (commands.length === 0) {
      this.suggestEl.hide();
      return;
    }
    this.suggestIndex = Math.min(this.suggestIndex, commands.length - 1);
    commands.forEach((command, index) => {
      const itemEl = createDiv(`chat-slash-item${index === this.suggestIndex ? " is-selected" : ""}`, this.suggestEl);
      createSpan({ cls: "chat-slash-name", text: `/${command.id}`, parent: itemEl });
      if (command.description) createSpan({ cls: "chat-slash-desc", text: command.description, parent: itemEl });
      itemEl.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.applyCommand(command);
      });
    });
    this.suggestEl.show();
  }

  private applyCommand(command: ChatSlashCommand): void {
    if (command.run) {
      this.setValue("");
      this.suggestEl.hide();
      command.run({
        getValue: () => this.getValue(),
        setValue: (value) => this.setValue(value),
        send: () => this.submit(),
      });
      return;
    }
    this.setValue(command.insertText ?? `/${command.id} `);
    this.inputEl.focus();
  }

  private onKeyDown(event: KeyboardEvent): void {
    const commands = this.matchingCommands();
    if (commands.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        this.suggestIndex = (this.suggestIndex + delta + commands.length) % commands.length;
        this.updateSuggest();
        return;
      }
      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        this.applyCommand(commands[this.suggestIndex]);
        return;
      }
      if (event.key === "Escape") {
        this.suggestEl.hide();
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this.submit();
    }
  }
}
