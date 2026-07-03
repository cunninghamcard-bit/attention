import { autocompletion, completionKeymap, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, insertNewline } from "@codemirror/commands";
import { Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { createDiv, createEl } from "../dom/dom";
import { Component } from "../core/Component";
import { ChatAttachmentBar } from "./ChatAttachmentBar";
import {
  appendChatInputHistory,
  chatDraftPersistence,
  clearChatDraft,
  readChatDraft,
  readChatInputHistory,
} from "./ChatComposerDrafts";
import { composerPasteExtension } from "./ChatComposerPaste";
import {
  listChatComposerActions,
  listChatComposerExtensions,
  listChatSlashCommands,
  onChatComposerExtensionsChanged,
} from "./ChatRegistry";
import type { ChatAttachmentPayload } from "./Agent";

export interface ChatComposerCallbacks {
  send(text: string, attachments: ChatAttachmentPayload[]): void;
  stop(): void;
  isRunning(): boolean;
  getWikilinkTargets?(): string[];
  // Multi-agent rooms feed participant names; "@" completes against them.
  // Mentions stay plain text — routing is the engine's business, not the UI's.
  getMentionTargets?(): string[];
}

export interface ChatComposerOptions {
  agentId?: string;
}

// The composer is a CodeMirror extension host, the way MarkdownView's editor
// is: plugins contribute Extensions through registerChatComposerExtension and
// completions ride the standard autocomplete pipeline.
export class ChatComposer extends Component {
  readonly el: HTMLElement;
  readonly attachmentBar: ChatAttachmentBar;
  private readonly editor: EditorView;
  private readonly sendButtonEl: HTMLButtonElement;
  private readonly pluginExtensions = new Compartment();
  private readonly agentId: string | null;
  private historyCursor = -1;
  private historyStash = "";

  constructor(
    parentEl: HTMLElement,
    private readonly callbacks: ChatComposerCallbacks,
    options: ChatComposerOptions = {},
  ) {
    super();
    this.agentId = options.agentId ?? null;
    this.el = createDiv("chat-composer", parentEl);
    this.attachmentBar = this.addChild(new ChatAttachmentBar(this.el));
    const rowEl = createDiv("chat-composer-row", this.el);
    const editorEl = createDiv("chat-composer-input", rowEl);

    const draftExtensions: Extension[] = this.agentId ? [chatDraftPersistence(this.agentId)] : [];
    this.editor = new EditorView({
      parent: editorEl,
      state: EditorState.create({
        doc: this.agentId ? (readChatDraft(this.agentId) ?? "") : "",
        extensions: [
          history(),
          placeholder("Message… (/ for commands, [[ for notes)"),
          EditorView.lineWrapping,
          autocompletion({ override: [(context) => this.completeSlashCommand(context), (context) => this.completeWikilink(context), (context) => this.completeMention(context)] }),
          Prec.high(keymap.of(completionKeymap)),
          keymap.of([
            { key: "Enter", run: () => this.submit() },
            { key: "Shift-Enter", run: insertNewline },
            { key: "ArrowUp", run: (view) => this.navigateHistory(view, -1) },
            { key: "ArrowDown", run: (view) => this.navigateHistory(view, 1) },
          ]),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          composerPasteExtension({
            addTextAttachment: (name, content) => this.attachmentBar.addText(name, content),
            addFileAttachment: (file) => this.attachmentBar.addFile(file),
          }),
          ...draftExtensions,
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
    const attachments = this.attachmentBar.list().map(({ name, content }) => ({ name, content }));
    if ((!text && attachments.length === 0) || this.callbacks.isRunning()) return true;
    this.setValue("");
    this.attachmentBar.clear();
    this.historyCursor = -1;
    appendChatInputHistory(text);
    if (this.agentId) clearChatDraft(this.agentId);
    this.callbacks.send(text, attachments);
    return true;
  }

  // ArrowUp/Down step through input history, but only when the cursor sits
  // at the document edge — mid-document arrows keep their editing meaning.
  private navigateHistory(view: EditorView, direction: -1 | 1): boolean {
    const { main } = view.state.selection;
    if (!main.empty) return false;
    if (direction === -1 && main.head !== 0) return false;
    if (direction === 1 && main.head !== view.state.doc.length) return false;
    const historyItems = readChatInputHistory();
    if (historyItems.length === 0) return false;

    if (this.historyCursor === -1) {
      if (direction === 1) return false;
      this.historyStash = this.getValue();
      this.historyCursor = historyItems.length - 1;
    } else {
      const next = this.historyCursor + direction;
      if (next >= historyItems.length) {
        this.historyCursor = -1;
        this.setValue(this.historyStash);
        return true;
      }
      if (next < 0) return true;
      this.historyCursor = next;
    }
    this.setValue(historyItems[this.historyCursor]);
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

  // "@name" anywhere in the draft, fed by the room's participants.
  private completeMention(context: CompletionContext): CompletionResult | null {
    const targets = this.callbacks.getMentionTargets?.();
    if (!targets?.length) return null;
    const match = context.matchBefore(/@[^\s@]*/);
    if (!match) return null;
    const options: Completion[] = targets.map((target) => ({
      label: `@${target}`,
      apply: `@${target} `,
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
