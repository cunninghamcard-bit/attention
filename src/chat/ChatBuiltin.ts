import type { App } from "../app/App";
import { registerChatSlashCommand } from "./ChatRegistry";
import { ChatView, CHAT_VIEW_TYPE } from "./ChatView";

export function newChatThreadId(): string {
  const random = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `thread-${random}`;
}

async function openChatLeaf(app: App, threadId?: string): Promise<void> {
  const activeChat = app.workspace.getActiveViewOfType(ChatView);
  if (activeChat && threadId) {
    await activeChat.leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true, state: { threadId } });
    return;
  }
  const existing = threadId ? null : app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0];
  const leaf = existing ?? app.workspace.getLeaf("tab");
  await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true, state: threadId ? { threadId } : undefined });
  await app.workspace.revealLeaf(leaf);
}

// Chat is the app's default strong view — MarkdownView-tier, not a togglable
// core plugin. The view type registers with the other builtin views; the
// command/ribbon/slash surface registers once the workspace exists.
export function registerChatViewType(app: App): void {
  app.viewRegistry.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf));
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

  // After layout-ready, like core plugin ribbon items: the ribbon stays
  // pristine during workspace construction and layout deserialization.
  app.workspace.onLayoutReady(() => {
    app.workspace.leftRibbon.addRibbonIcon("lucide-message-circle", "Open chat", () => void openChatLeaf(app), "chat:open");
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
