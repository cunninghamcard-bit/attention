import { createDiv } from "../dom/dom";
import { ItemView } from "../views/ItemView";
import type { WorkspaceLeaf } from "../workspace/WorkspaceLeaf";
import { ChatComposer } from "./ChatComposer";
import { ChatMessageList } from "./ChatMessageList";
import { ChatScroller } from "./ChatScroller";
import { getChatSession, type ChatSession } from "./ChatSession";
import { ChatTransport } from "./ChatTransport";
import { ensureChatStyles } from "./ChatStyles";

export const CHAT_VIEW_TYPE = "chat";

interface ChatViewEphemeralState {
  draft?: string;
  scrollTop?: number;
}

export class ChatView extends ItemView {
  override icon = "lucide-message-circle";
  private threadId = "default";
  private session: ChatSession | null = null;
  private list: ChatMessageList | null = null;
  private composer: ChatComposer | null = null;
  private scroller: ChatScroller | null = null;
  private scrollEl: HTMLElement | null = null;
  private errorEl: HTMLElement | null = null;
  private syncScheduled = false;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.threadId === "default" ? "Chat" : `Chat – ${this.threadId}`;
  }

  async onOpen(): Promise<void> {
    ensureChatStyles();
    this.contentEl.classList.add("chat-view");
    this.initFor(this.threadId);
  }

  async onClose(): Promise<void> {
    await super.onClose();
  }

  override async setState(state: unknown, result?: unknown): Promise<void> {
    await super.setState(state, result as never);
    if (state && typeof state === "object" && "threadId" in state) {
      const next = String((state as { threadId?: unknown }).threadId ?? "default");
      if (next !== this.threadId) {
        this.threadId = next;
        if (this.contentEl.classList.contains("chat-view")) this.initFor(next);
      }
    }
  }

  override getState(): Record<string, unknown> {
    return { threadId: this.threadId };
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

  private initFor(threadId: string): void {
    if (this.list) this.removeChild(this.list);
    if (this.composer) this.removeChild(this.composer);
    if (this.scroller) this.removeChild(this.scroller);
    this.contentEl.empty();

    this.session = getChatSession(threadId, new ChatTransport());
    this.scrollEl = createDiv("chat-scroll", this.contentEl);
    this.list = this.addChild(new ChatMessageList(this.scrollEl, this.session));
    this.scroller = this.addChild(new ChatScroller(this.scrollEl, this.scrollEl));
    this.errorEl = createDiv("chat-error", this.contentEl);
    this.errorEl.hide();
    this.composer = this.addChild(
      new ChatComposer(this.contentEl, {
        send: (text) => void this.sendMessage(text),
        stop: () => void this.session?.stop(),
        isRunning: () => this.session?.isRunning() ?? false,
      }),
    );

    this.registerEvent(this.session.on("changed", () => this.scheduleSync()));
    this.scheduleSync();
    this.composer.focus();
  }

  private async sendMessage(text: string): Promise<void> {
    try {
      this.errorEl?.hide();
      await this.session?.sendMessage(text);
    } catch (error) {
      if (this.errorEl) {
        this.errorEl.setText(`Cannot reach the chat bridge: ${error instanceof Error ? error.message : String(error)}`);
        this.errorEl.show();
      }
    }
  }

  // One animation frame coalesces any number of part deltas into a single
  // parse + DOM update pass.
  private scheduleSync(): void {
    if (this.syncScheduled) return;
    this.syncScheduled = true;
    requestAnimationFrame(() => {
      this.syncScheduled = false;
      this.list?.sync();
      this.composer?.syncRunning();
      if (this.session?.state.lastError && this.errorEl) {
        this.errorEl.setText(this.session.state.lastError);
        this.errorEl.show();
      }
      this.scroller?.notifyContentChanged();
    });
  }
}
