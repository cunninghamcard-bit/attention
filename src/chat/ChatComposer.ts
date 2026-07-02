import { autocompletion, completionKeymap, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, insertNewline } from "@codemirror/commands";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { createDiv, createEl } from "../dom/dom";
import { Component } from "../core/Component";
import {
  listChatComposerActions,
  listChatComposerExtensions,
  listChatSlashCommands,
  onChatComposerExtensionsChanged,
} from "./ChatRegistry";

export interface ChatComposerCallbacks {
  send(text: string): void;
  stop(): void;
  isRunning(): boolean;
  getWikilinkTargets?(): string[];
}

// The composer is a CodeMirror extension host, the way MarkdownView's editor
// is: plugins contribute Extensions through registerChatComposerExtension and
// completions ride the standard autocomplete pipeline.
export class ChatComposer extends Component {
  readonly el: HTMLElement;
  private readonly editor: EditorView;
  private readonly sendButtonEl: HTMLButtonElement;
  private readonly pluginExtensions = new Compartment();

  constructor(parentEl: HTMLElement, private readonly callbacks: ChatComposerCallbacks) {
    super();
    this.el = createDiv("chat-composer", parentEl);
    const rowEl = createDiv("chat-composer-row", this.el);
    const editorEl = createDiv("chat-composer-input", rowEl);

    this.editor = new EditorView({
      parent: editorEl,
      state: EditorState.create({
        extensions: [
          history(),
          placeholder("Message… (/ for commands, [[ for notes)"),
          EditorView.lineWrapping,
          autocompletion({ override: [(context) => this.completeSlashCommand(context), (context) => this.completeWikilink(context)] }),
          Prec.high(keymap.of(completionKeymap)),
          keymap.of([
            { key: "Enter", run: () => this.submit() },
            { key: "Shift-Enter", run: insertNewline },
          ]),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          this.pluginExtensions.of(listChatComposerExtensions()),
        ],
      }),
    });

    const actionsEl = createDiv("chat-composer-actions", rowEl);
    for (const action of listChatComposerActions()) {
      const buttonEl = createEl("button", { cls: "chat-composer-action", parent: actionsEl, text: action.title });
      buttonEl.addEventListener("click", () =>
        action.onClick({
          getValue: () => this.getValue(),
          setValue: (value) => this.setValue(value),
          send: () => void this.submit(),
        }),
      );
    }
    this.sendButtonEl = createEl("button", { cls: "chat-composer-send mod-cta", parent: actionsEl, text: "Send" });
  }

  override onload(): void {
    this.registerDomEvent(this.sendButtonEl, "click", () => (this.callbacks.isRunning() ? this.callbacks.stop() : void this.submit()));
    this.register(onChatComposerExtensionsChanged(() => {
      this.editor.dispatch({ effects: this.pluginExtensions.reconfigure(listChatComposerExtensions()) });
    }));
    this.register(() => this.editor.destroy());
  }

  getValue(): string {
    return this.editor.state.doc.toString();
  }

  setValue(value: string): void {
    this.editor.dispatch({ changes: { from: 0, to: this.editor.state.doc.length, insert: value } });
  }

  focus(): void {
    this.editor.focus();
  }

  syncRunning(): void {
    const running = this.callbacks.isRunning();
    this.sendButtonEl.setText(running ? "Stop" : "Send");
    this.sendButtonEl.toggleClass("is-running", running);
  }

  private submit(): boolean {
    const text = this.getValue().trim();
    if (!text || this.callbacks.isRunning()) return true;
    this.setValue("");
    this.callbacks.send(text);
    return true;
  }

  // "/command" at the very start of the draft.
  private completeSlashCommand(context: CompletionContext): CompletionResult | null {
    const match = context.matchBefore(/^\/[\w-]*/);
    if (!match || (match.from === match.to && !context.explicit)) return null;
    const options: Completion[] = listChatSlashCommands().map((command) => ({
      label: `/${command.id}`,
      detail: command.description ?? command.name,
      apply: (view) => {
        if (command.run) {
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "" } });
          command.run({
            getValue: () => this.getValue(),
            setValue: (value) => this.setValue(value),
            send: () => void this.submit(),
          });
          return;
        }
        const insert = command.insertText ?? `/${command.id} `;
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert }, selection: { anchor: insert.length } });
      },
    }));
    return { from: match.from, options, filter: true };
  }

  // "[[target" anywhere in the draft, fed by the vault via the view.
  private completeWikilink(context: CompletionContext): CompletionResult | null {
    const targets = this.callbacks.getWikilinkTargets?.();
    if (!targets?.length) return null;
    const match = context.matchBefore(/\[\[[^\][]*/);
    if (!match) return null;
    const options: Completion[] = targets.map((target) => ({
      label: target,
      apply: `${target}]] `,
    }));
    // from skips the "[[" so CM filters options against the typed link text.
    return { from: match.from + 2, options, filter: true };
  }
}
