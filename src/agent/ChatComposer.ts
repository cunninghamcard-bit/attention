import { autocompletion, completionKeymap, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, insertNewline } from "@codemirror/commands";
import { Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { createDiv, createEl, createSpan } from "../dom/dom";
import { Component } from "../core/Component";
import { STRINGS } from "./AgentStrings";
import { setIcon } from "../ui/Icon";
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
  // Submitting while a run is active queues instead of sending; ChatView
  // wires this to session.queueMessage.
  queue(text: string, attachments: ChatAttachmentPayload[]): void;
  stop(): void;
  isRunning(): boolean;
  getWikilinkTargets?(): string[];
  // Multi-agent rooms feed participant names; "@" completes against them.
  // Mentions stay plain text — routing is the engine's business, not the UI's.
  getMentionTargets?(): string[];
  // The composer-integrated config chip (ArkLoop's ModelPicker shape): the
  // host names the current selection and owns the menu; absent = no chip.
  getModelLabel?(): string;
  openModelMenu?(event: MouseEvent): void;
}

export interface ChatComposerOptions {
  agentId?: string;
}

// Shared by the attach button, drag-and-drop, and paste: images fall through
// to addFile so ChatAttachmentBar's existing rejection Notice fires once,
// in one place, instead of being re-checked at every ingestion site.
async function ingestAttachmentFile(bar: ChatAttachmentBar, file: File): Promise<void> {
  if (file.type.startsWith("image/")) {
    bar.addFile(file);
    return;
  }
  bar.addText(file.name, await file.text());
}

// The composer is a CodeMirror extension host, the way MarkdownView's editor
// is: plugins contribute Extensions through registerChatComposerExtension and
// completions ride the standard autocomplete pipeline.
export class ChatComposer extends Component {
  readonly el: HTMLElement;
  readonly attachmentBar: ChatAttachmentBar;
  private readonly editor: EditorView;
  private readonly sendButtonEl: HTMLButtonElement;
  private modelChipEl: HTMLButtonElement | null = null;
  private modelChipLabelEl: HTMLElement | null = null;
  private readonly attachButtonEl: HTMLButtonElement;
  private readonly attachInputEl: HTMLInputElement;
  private readonly cardEl: HTMLElement;
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
    // ArkLoop-style input card: the card is the visual unit (border, focus
    // ring, shadow); the editor sits chromeless inside, a toolbar row below.
    const cardEl = createDiv("chat-composer-card", this.el);
    this.cardEl = cardEl;
    const editorEl = createDiv("chat-composer-input", cardEl);

    const draftExtensions: Extension[] = this.agentId ? [chatDraftPersistence(this.agentId)] : [];
    this.editor = new EditorView({
      parent: editorEl,
      state: EditorState.create({
        doc: this.agentId ? (readChatDraft(this.agentId) ?? "") : "",
        extensions: [
          history(),
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
          EditorView.updateListener.of((update) => {
            if (update.docChanged) this.syncSendState();
          }),
          composerPasteExtension({
            addTextAttachment: (name, content) => {
              this.attachmentBar.addText(name, content);
              this.syncSendState();
            },
            addFileAttachment: (file) => {
              this.attachmentBar.addFile(file);
              this.syncSendState();
            },
          }),
          ...draftExtensions,
          this.pluginExtensions.of(listChatComposerExtensions()),
        ],
      }),
    });

    const toolbarEl = createDiv("chat-composer-toolbar", cardEl);
    // Hidden picker input: the button is the only visible affordance, the
    // way a native file-attach control works in ArkLoop/Claude Desktop.
    this.attachInputEl = createEl("input", { cls: "chat-composer-attach-input", parent: toolbarEl, attr: { type: "file", multiple: true } });
    this.attachInputEl.hide();
    this.attachButtonEl = createEl("button", { cls: "chat-composer-attach", parent: toolbarEl, title: STRINGS.composer.attach });
    setIcon(this.attachButtonEl, "lucide-plus");
    if (this.callbacks.getModelLabel && this.callbacks.openModelMenu) {
      this.modelChipEl = createEl("button", { cls: "chat-model-chip", parent: toolbarEl });
      this.modelChipLabelEl = createSpan({ cls: "chat-model-chip-label", parent: this.modelChipEl });
      setIcon(createSpan({ cls: "chat-model-chip-chevron", parent: this.modelChipEl }), "lucide-chevron-down");
      this.modelChipEl.addEventListener("click", (event) => this.callbacks.openModelMenu!(event));
      this.refreshModelChip();
    }
    const actionsEl = createDiv("chat-composer-actions", toolbarEl);
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
    // One slot, ArkLoop-style: empty draft shows nothing; the arrow springs
    // in when there is something to send; streaming swaps it for a drawn
    // record-stop glyph (ring + square). All swaps are CSS-only.
    this.sendButtonEl = createEl("button", { cls: "chat-composer-send", parent: actionsEl, title: STRINGS.composer.send });
    setIcon(this.sendButtonEl, "lucide-arrow-up");
    const stopEl = createSpan({ cls: "chat-stop-glyph", parent: this.sendButtonEl });
    createSpan({ cls: "chat-stop-glyph-square", parent: stopEl });
  }

  override onload(): void {
    this.registerDomEvent(this.sendButtonEl, "click", () => (this.callbacks.isRunning() ? this.callbacks.stop() : void this.submit()));
    this.registerDomEvent(this.attachButtonEl, "click", () => this.attachInputEl.click());
    this.registerDomEvent(this.attachInputEl, "change", () => {
      void this.ingestFiles(this.attachInputEl.files).then(() => (this.attachInputEl.value = ""));
    });
    // dragover must preventDefault for drop to fire; is-dragging is purely
    // a border cue, cleared on dragleave so it doesn't stick after a miss.
    this.registerDomEvent(this.cardEl, "dragover", (event) => {
      event.preventDefault();
      this.cardEl.addClass("is-dragging");
    });
    this.registerDomEvent(this.cardEl, "dragleave", () => this.cardEl.removeClass("is-dragging"));
    this.registerDomEvent(this.cardEl, "drop", (event) => {
      event.preventDefault();
      this.cardEl.removeClass("is-dragging");
      void this.ingestFiles(event.dataTransfer?.files ?? null);
    });
    this.register(onChatComposerExtensionsChanged(() => {
      this.editor.dispatch({ effects: this.pluginExtensions.reconfigure(listChatComposerExtensions()) });
    }));
    this.register(() => this.editor.destroy());
  }

  // Shared sink for the attach button and drag-and-drop; each file becomes
  // an attachment (or triggers ChatAttachmentBar's image-rejection Notice).
  private async ingestFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    for (const file of files) await ingestAttachmentFile(this.attachmentBar, file);
    this.syncSendState();
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

  // The send button is quiet until there is something to send.
  private syncSendState(): void {
    this.sendButtonEl.toggleClass("is-ready", this.getValue().trim().length > 0 || !this.attachmentBar.isEmpty());
  }

  refreshModelChip(): void {
    if (this.modelChipLabelEl && this.callbacks.getModelLabel) this.modelChipLabelEl.setText(this.callbacks.getModelLabel());
  }

  syncRunning(): void {
    const running = this.callbacks.isRunning();
    this.sendButtonEl.title = running ? STRINGS.composer.stop : STRINGS.composer.send;
    this.sendButtonEl.toggleClass("is-running", running);
  }

  private submit(): boolean {
    const text = this.getValue().trim();
    const attachments = this.attachmentBar.list().map(({ name, content }) => ({ name, content }));
    if (!text && attachments.length === 0) return true;
    const running = this.callbacks.isRunning();
    if (running && !text) return true;
    this.setValue("");
    this.attachmentBar.clear();
    this.historyCursor = -1;
    appendChatInputHistory(text);
    if (this.agentId) clearChatDraft(this.agentId);
    if (running) this.callbacks.queue(text, attachments);
    else this.callbacks.send(text, attachments);
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
