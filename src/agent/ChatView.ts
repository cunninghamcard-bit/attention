import { writeClipboardText } from "../dom/Clipboard";
import { Notice } from "../ui/Notice";
import { Menu } from "../ui/Menu";
import { StreamView } from "../views/StreamView";
import type { WorkspaceLeaf } from "../workspace/WorkspaceLeaf";
import { ChatComposer } from "./ChatComposer";
import { ChatMessageList } from "./ChatMessageList";
import { chatTranscriptToMarkdown, type ChatAttachmentPayload, type Agent } from "./Agent";
import { STRINGS } from "./AgentStrings";
import { AgentTransport, type AgentProfile } from "./AgentTransport";
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
  override icon = "message-circle";
  override navigation = true;
  protected agentId = "default";
  protected agentTitle: string | null = null;
  protected session: Agent | null = null;
  private list: ChatMessageList | null = null;
  protected composer: ChatComposer | null = null;
  private stopActionEl: HTMLElement | null = null;
  // Set on send: the next sync pins the new user message to the viewport top
  // (ArkLoop-style anchoring) so the reply reads downward from the question.
  private anchorPending = false;
  private readonly profileTransport = new AgentTransport();
  protected profile: AgentProfile = {};

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    if (this.agentTitle) return this.agentTitle;
    return this.agentId === "default" ? STRINGS.chat.displayText : STRINGS.chat.displayTextFor(this.agentId);
  }

  isRunning(): boolean {
    return this.session?.isRunning() ?? false;
  }

  async stopRun(): Promise<void> {
    await this.session?.stop();
  }

  setComposerText(text: string): void {
    this.composer?.setValue(text);
    this.composer?.focus();
  }

  async onOpen(): Promise<void> {
    ensureChatStyles(this.app);
    this.contentEl.classList.add("chat-view");
    this.addAction("message-circle-plus", STRINGS.menu.newAgent, () => this.app.commands.executeCommandById("agent:create"));
    this.stopActionEl = this.addAction("lucide-square", STRINGS.slash.stop, () => void this.stopRun());
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
      .setTitle(STRINGS.menu.agentProperties)
      .setIcon("bot")
      .onClick(() => this.app.commands.executeCommandById("agent:open-properties")));
    menu.addItem((item) => item
      .setSection("action")
      .setTitle(STRINGS.menu.newAgent)
      .setIcon("message-circle-plus")
      .onClick(() => this.app.commands.executeCommandById("agent:create")));
    menu.addItem((item) => item
      .setSection("action")
      .setTitle(STRINGS.menu.copyConversation)
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
    this.list = this.addChild(new ChatMessageList(scrollEl, this.session, () => this.scroller?.notifyContentChanged()));
    this.composer = this.addChild(
      new ChatComposer(
        this.contentEl,
        {
          send: (text, attachments) => void this.sendMessage(text, attachments),
          queue: (text, attachments) => this.session?.queueMessage(text, attachments),
          stop: () => void this.stopRun(),
          isRunning: () => this.isRunning(),
          getWikilinkTargets: () => this.app.vault.getMarkdownFiles().map((file) => file.basename),
          getMentionTargets: () => this.mentionTargets(),
          getModelLabel: () => this.modelChipLabel(),
          openModelMenu: (event) => void this.openModelMenu(event),
        },
        { agentId },
      ),
    );

    this.registerEvent(this.session.on("changed", () => this.scheduleSync()));
    void this.profileTransport.getAgent(agentId).then((summary) => {
      if (summary?.profile) {
        this.profile = summary.profile;
        this.composer?.refreshModelChip();
      }
    });
    this.onChatChromeReady();
    this.scheduleSync();
    this.composer.focus();
  }

  // Called after the chat regions rebuild; subclasses add their chrome here
  // (MultiAgentView inserts its participants strip above the stream).
  protected onChatChromeReady(): void {}

  private modelChipLabel(): string {
    const model = this.profile.model ?? STRINGS.composer.modelDefault;
    return this.profile.effort ? `${model} · ${this.profile.effort}` : model;
  }

  // The composer-integrated config: models from the engine, reasoning
  // effort beneath them. The full profile (params, everything) lives in
  // AgentPropertiesView; this menu is the quick switch.
  private async openModelMenu(event: MouseEvent): Promise<void> {
    const { models, efforts } = await this.profileTransport.listModels();
    const effortLevels = efforts.length > 0 ? efforts : ["low", "medium", "high"];
    const menu = new Menu(this.containerEl.ownerDocument);
    const pick = (patch: Partial<AgentProfile>) => {
      Object.assign(this.profile, patch);
      void this.profileTransport.updateProfile(this.agentId, this.profile);
      this.composer?.refreshModelChip();
    };
    menu.addItem((item) => item
      .setTitle(STRINGS.composer.modelDefault)
      .setChecked(!this.profile.model)
      .onClick(() => pick({ model: undefined })));
    for (const model of models) {
      menu.addItem((item) => item
        .setTitle(model)
        .setChecked(this.profile.model === model)
        .onClick(() => pick({ model })));
    }
    menu.addSeparator();
    for (const effort of ["", ...effortLevels]) {
      menu.addItem((item) => item
        .setTitle(effort || STRINGS.properties.effortDefault)
        .setChecked((this.profile.effort ?? "") === effort)
        .onClick(() => pick({ effort: effort || undefined })));
    }
    menu.showAtMouseEvent(event);
  }

  // "@" completion targets; single-agent chats have none, rooms feed their
  // participants.
  protected mentionTargets(): string[] {
    return [];
  }

  // Transport failure is transient app trouble, not conversation content —
  // it surfaces as a Notice, the way Obsidian reports failed operations.
  // Run errors are history events and render inside the stream.
  private async sendMessage(text: string, attachments: ChatAttachmentPayload[] = []): Promise<void> {
    try {
      this.anchorPending = true;
      await this.session?.sendMessage(text, attachments);
    } catch (error) {
      new Notice(STRINGS.notices.bridgeUnreachable(error instanceof Error ? error.message : String(error)));
    }
  }

  private async copyConversation(): Promise<void> {
    if (!this.session) return;
    await writeClipboardText(chatTranscriptToMarkdown(this.session.getMessages()));
    new Notice(STRINGS.notices.conversationCopied);
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
    this.anchorLastUserMessage();
    this.composer?.syncRunning();
    this.stopActionEl?.toggle(this.isRunning());
    this.refreshTitle();
  }

  // Pin the just-sent user message toward the viewport top and detach the
  // scroller: the reply streams downward from the question instead of the
  // viewport chasing the bottom. Without a spacer the pin clamps at the
  // current bottom, but the position stays stable while the reply grows.
  // ponytail: no bottom spacer — exact-top pinning on short content needs
  // one; add it if the clamped position reads badly in practice.
  private anchorLastUserMessage(): void {
    if (!this.anchorPending || !this.scrollEl) return;
    const userEls = this.scrollEl.querySelectorAll('.chat-message[data-role="user"]');
    const target = userEls[userEls.length - 1] as HTMLElement | undefined;
    if (!target) return;
    this.anchorPending = false;
    this.scrollEl.scrollTop += target.getBoundingClientRect().top - this.scrollEl.getBoundingClientRect().top - 8;
    this.scroller?.detach();
  }

}
