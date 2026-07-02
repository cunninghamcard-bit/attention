import { createDiv } from "../dom/dom";
import { writeClipboardText } from "../dom/Clipboard";
import { Notice } from "../ui/Notice";
import type { Menu } from "../ui/Menu";
import { StreamView } from "../views/StreamView";
import type { WorkspaceLeaf } from "../workspace/WorkspaceLeaf";
import { ChatComposer } from "./ChatComposer";
import { ChatMessageList } from "./ChatMessageList";
import { chatTranscriptToMarkdown, type ChatAttachmentPayload, type Agent } from "./Agent";
import { ensureChatStyles } from "./ChatStyles";
import { MarkdownRenderer } from "../markdown/MarkdownRenderer";
import type { App } from "../app/App";

export const CHAT_VIEW_TYPE = "chat";

const TITLE_MAX_LENGTH = 40;

interface ChatViewEphemeralState {
  draft?: string;
  scrollTop?: number;
}

export class ChatView extends StreamView {
  override icon = "lucide-message-circle";
  override navigation = true;
  private agentId = "default";
  private agentTitle: string | null = null;
  private session: Agent | null = null;
  private list: ChatMessageList | null = null;
  private composer: ChatComposer | null = null;
  private errorEl: HTMLElement | null = null;
  private stopActionEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    if (this.agentTitle) return this.agentTitle;
    return this.agentId === "default" ? "Chat" : `Chat – ${this.agentId}`;
  }

  isRunning(): boolean {
    return this.session?.isRunning() ?? false;
  }

  async stopRun(): Promise<void> {
    await this.session?.stop();
  }

  async onOpen(): Promise<void> {
    ensureChatStyles(this.app);
    this.contentEl.classList.add("chat-view");
    this.addAction("lucide-message-circle-plus", "New agent", () => this.app.commands.executeCommandById("agent:create"));
    this.stopActionEl = this.addAction("lucide-square", "Stop response", () => void this.stopRun());
    this.stopActionEl.hide();
    this.initFor(this.agentId);
  }

  async onClose(): Promise<void> {
    await super.onClose();
  }

  override onPaneMenu(menu: Menu, source?: string): void {
    super.onPaneMenu(menu, source);
    menu.addItem((item) => item
      .setSection("action")
      .setTitle("New agent")
      .setIcon("lucide-message-circle-plus")
      .onClick(() => this.app.commands.executeCommandById("agent:create")));
    menu.addItem((item) => item
      .setSection("action")
      .setTitle("Copy conversation")
      .setIcon("lucide-copy")
      .setDisabled(!this.session || this.session.getMessages().length === 0)
      .onClick(() => void this.copyConversation()));
  }

  override async setState(state: unknown, result?: unknown): Promise<void> {
    await super.setState(state, result as never);
    if (state && typeof state === "object" && "agentId" in state) {
      const next = String((state as { agentId?: unknown }).agentId ?? "default");
      if (next !== this.agentId) {
        this.agentId = next;
        this.agentTitle = null;
        if (this.contentEl.classList.contains("chat-view")) this.initFor(next);
        this.refreshTitle();
      }
    }
  }

  override getState(): Record<string, unknown> {
    return { agentId: this.agentId };
  }

  override setEphemeralState(state: unknown): void {
    const ephemeral = (state ?? {}) as ChatViewEphemeralState;
    if (ephemeral.draft !== undefined) this.composer?.setValue(ephemeral.draft);
    if (ephemeral.scrollTop !== undefined && this.scrollEl) this.scrollEl.scrollTop = ephemeral.scrollTop;
  }

  override getEphemeralState(): ChatViewEphemeralState {
    return {
      draft: this.composer?.getValue() ?? "",
      scrollTop: this.scrollEl?.scrollTop ?? 0,
    };
  }

  private initFor(agentId: string): void {
    if (this.list) this.removeChild(this.list);
    if (this.composer) this.removeChild(this.composer);
    if (this.scroller) this.removeChild(this.scroller);
    this.contentEl.empty();

    this.session = this.app.agents.get(agentId);
    const scrollEl = this.createStreamRegion("chat-scroll");
    // Chat speaks MarkdownView's element vocabulary, so the same delegated
    // handlers give internal links their click/hover/context-menu behavior.
    (MarkdownRenderer as unknown as {
      installInternalLinkHandlers(app: App, root: HTMLElement, sourcePath: string): void;
    }).installInternalLinkHandlers(this.app, scrollEl, `agent://${agentId}`);
    this.list = this.addChild(new ChatMessageList(scrollEl, this.session));
    this.errorEl = createDiv("chat-error", this.contentEl);
    this.errorEl.hide();
    this.composer = this.addChild(
      new ChatComposer(
        this.contentEl,
        {
          send: (text, attachments) => void this.sendMessage(text, attachments),
          stop: () => void this.stopRun(),
          isRunning: () => this.isRunning(),
          getWikilinkTargets: () => this.app.vault.getMarkdownFiles().map((file) => file.basename),
        },
        { agentId },
      ),
    );

    this.registerEvent(this.session.on("changed", () => this.scheduleSync()));
    this.scheduleSync();
    this.composer.focus();
  }

  private async sendMessage(text: string, attachments: ChatAttachmentPayload[] = []): Promise<void> {
    try {
      this.errorEl?.hide();
      await this.session?.sendMessage(text, attachments);
    } catch (error) {
      if (this.errorEl) {
        this.errorEl.setText(`Cannot reach the chat bridge: ${error instanceof Error ? error.message : String(error)}`);
        this.errorEl.show();
      }
    }
  }

  private async copyConversation(): Promise<void> {
    if (!this.session) return;
    await writeClipboardText(chatTranscriptToMarkdown(this.session.getMessages()));
    new Notice("Conversation copied");
  }

  // The tab title follows the thread: first line of the first user message.
  private refreshTitle(): void {
    const firstUserMessage = this.session?.getMessages().find((message) => message.role === "user");
    const textPart = firstUserMessage?.parts.find((part) => part?.type === "text");
    const line = (textPart && "markdown" in textPart ? textPart.markdown : "").trim().split("\n")[0] ?? "";
    const title = line ? (line.length > TITLE_MAX_LENGTH ? `${line.slice(0, TITLE_MAX_LENGTH)}…` : line) : null;
    if (title === this.agentTitle) return;
    this.agentTitle = title;
    this.updateHeader();
    this.leaf.tabHeaderInnerTitleEl.textContent = this.getDisplayText();
  }

  protected onStreamSync(): void {
    this.list?.sync();
    this.composer?.syncRunning();
    this.stopActionEl?.toggle(this.isRunning());
    this.refreshTitle();
    if (this.session?.state.lastError && this.errorEl) {
      this.errorEl.setText(this.session.state.lastError);
      this.errorEl.show();
    }
  }
}
