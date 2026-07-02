import { createDiv, createSpan } from "../dom/dom";
import { ItemView } from "../views/ItemView";
import type { WorkspaceLeaf } from "../workspace/WorkspaceLeaf";
import { openChatThread } from "./ChatBuiltin";
import { ensureChatStyles } from "./ChatStyles";
import { ChatTransport, type ChatThreadSummary } from "./ChatTransport";
import { ChatView } from "./ChatView";

export const CHAT_THREADS_VIEW_TYPE = "chat-threads";

const REFRESH_INTERVAL_MS = 5000;

function formatRelativeTime(timestamp: number): string {
  const deltaSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 60) return "just now";
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h ago`;
  return `${Math.floor(deltaSeconds / 86400)}d ago`;
}

// Sidebar list of conversations, the TagPane/Backlinks of the chat world:
// the bridge is the source of truth, the view polls while open.
export class ChatThreadsView extends ItemView {
  override icon = "lucide-messages-square";
  private readonly transport = new ChatTransport();
  private listEl: HTMLElement | null = null;
  private threads: ChatThreadSummary[] = [];

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return CHAT_THREADS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Chat threads";
  }

  async onOpen(): Promise<void> {
    ensureChatStyles();
    this.contentEl.classList.add("chat-threads-view");
    this.listEl = createDiv("chat-threads-list", this.contentEl);
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.render()));
    this.registerInterval(window.setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS));
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      this.threads = await this.transport.listThreads();
    } catch {
      this.threads = [];
    }
    this.render();
  }

  private activeThreadId(): string | null {
    const view = this.app.workspace.getActiveViewOfType(ChatView);
    if (!view) return null;
    const state = view.getState();
    return typeof state.threadId === "string" ? state.threadId : null;
  }

  private render(): void {
    if (!this.listEl) return;
    this.listEl.empty();
    if (this.threads.length === 0) {
      createDiv({ cls: "chat-threads-empty", text: "No conversations yet.", parent: this.listEl });
      return;
    }
    const activeId = this.activeThreadId();
    for (const thread of this.threads) {
      const itemEl = createDiv(`chat-thread-item${thread.id === activeId ? " is-active" : ""}`, this.listEl);
      const titleEl = createDiv("chat-thread-title", itemEl);
      if (thread.running) createSpan({ cls: "chat-thread-running", parent: titleEl });
      titleEl.appendText(thread.title ?? thread.id);
      createDiv({ cls: "chat-thread-time", text: formatRelativeTime(thread.updatedAt), parent: itemEl });
      itemEl.addEventListener("click", () => void openChatThread(this.app, thread.id));
    }
  }
}
