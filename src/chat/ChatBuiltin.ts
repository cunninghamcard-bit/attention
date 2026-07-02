import type { App } from "../app/App";
import { writeClipboardText } from "../dom/Clipboard";
import { Notice } from "../ui/Notice";
import { registerChatMessageAction, registerChatSlashCommand } from "./ChatRegistry";
import { chatMessageToMarkdown } from "./ChatSession";
import { ChatThreadsView, CHAT_THREADS_VIEW_TYPE } from "./ChatThreadsView";
import { ChatView, CHAT_VIEW_TYPE } from "./ChatView";

export function newChatThreadId(): string {
  const random = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `thread-${random}`;
}

// Opens a specific thread, preferring a leaf that already shows it, then the
// active chat leaf, then any chat leaf, then a new tab.
export async function openChatThread(app: App, threadId: string): Promise<void> {
  const leaves = app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
  const showing = leaves.find((leaf) => (leaf.view as ChatView | null)?.getState()?.threadId === threadId);
  const leaf = showing ?? app.workspace.getActiveViewOfType(ChatView)?.leaf ?? leaves[0] ?? app.workspace.getLeaf("tab");
  await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true, state: { threadId } });
  await app.workspace.revealLeaf(leaf);
}

async function openChatLeaf(app: App, threadId?: string): Promise<void> {
  if (threadId) {
    await openChatThread(app, threadId);
    return;
  }
  const leaf = app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0] ?? app.workspace.getLeaf("tab");
  await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
  await app.workspace.revealLeaf(leaf);
}

// Chat is the app's default strong view — MarkdownView-tier, not a togglable
// core plugin. The view type registers with the other builtin views; the
// command/ribbon/slash surface registers once the workspace exists.
export function registerChatViewType(app: App): void {
  app.viewRegistry.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf));
  app.viewRegistry.registerView(CHAT_THREADS_VIEW_TYPE, (leaf) => new ChatThreadsView(leaf));
}

export function registerChatBuiltin(app: App): void {
  app.commands.addCommand({
    id: "chat:open",
    name: "Open chat",
    icon: "lucide-message-circle",
    hotkeys: [{ modifiers: ["Mod", "Shift"], key: "c" }],
    callback: () => void openChatLeaf(app),
  });
  app.commands.addCommand({
    id: "chat:new-thread",
    name: "Start new chat thread",
    icon: "lucide-message-circle-plus",
    callback: () => void openChatLeaf(app, newChatThreadId()),
  });
  app.commands.addCommand({
    id: "chat:stop",
    name: "Stop chat response",
    icon: "lucide-square",
    checkCallback: (checking) => {
      const view = app.workspace.getActiveViewOfType(ChatView);
      const running = Boolean(view?.isRunning());
      if (!checking && running) void view?.stopRun();
      return running;
    },
  });

  app.commands.addCommand({
    id: "chat:open-threads",
    name: "Open chat threads",
    icon: "lucide-messages-square",
    callback: () => void app.workspace.ensureSideLeaf(CHAT_THREADS_VIEW_TYPE, "right", { active: true, reveal: true }),
  });

  // After layout-ready, like core plugin ribbon items: the ribbon stays
  // pristine during workspace construction and layout deserialization.
  app.workspace.onLayoutReady(() => {
    app.workspace.leftRibbon.addRibbonIcon("lucide-message-circle", "Open chat", () => void openChatLeaf(app), "chat:open");
    void app.workspace.ensureSideLeaf(CHAT_THREADS_VIEW_TYPE, "right", { reveal: false });
  });

  registerChatMessageAction({
    id: "copy",
    title: "Copy",
    run: (message) => {
      void writeClipboardText(chatMessageToMarkdown(message)).then(() => new Notice("Message copied"));
    },
  });

  registerChatSlashCommand({
    id: "new",
    name: "New thread",
    description: "Start a fresh conversation",
    run: () => void openChatLeaf(app, newChatThreadId()),
  });
  registerChatSlashCommand({
    id: "stop",
    name: "Stop response",
    description: "Interrupt the running response",
    run: () => void app.workspace.getActiveViewOfType(ChatView)?.stopRun(),
  });
}
