import type { App } from "../app/App";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../plugin/InternalPluginWrapper";
import { registerChatSlashCommand } from "./ChatRegistry";
import { ChatSettingTab } from "./ChatSettingTab";
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

export function createChatPluginDefinition(): InternalPluginDefinition {
  return {
    id: "chat",
    name: "Chat",
    description: "Talk to a coding agent inside the workspace.",
    defaultOn: true,
    init(app: App, plugin: InternalPluginWrapper) {
      plugin.registerViewType(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf));
      plugin.registerGlobalCommand({
        id: "chat:open",
        name: "Open chat",
        icon: "lucide-message-circle",
        hotkeys: [{ modifiers: ["Mod", "Shift"], key: "c" }],
        callback: () => void openChatLeaf(app),
      });
      plugin.registerGlobalCommand({
        id: "chat:new-thread",
        name: "Start new chat thread",
        icon: "lucide-message-circle-plus",
        callback: () => void openChatLeaf(app, newChatThreadId()),
      });
      plugin.registerGlobalCommand({
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
    },
    onEnable(app: App, plugin: InternalPluginWrapper) {
      plugin.addRibbonIcon("lucide-message-circle", "Open chat", () => void openChatLeaf(app));
      plugin.addSettingTab(new ChatSettingTab(app));
      plugin.register(
        registerChatSlashCommand({
          id: "new",
          name: "New thread",
          description: "Start a fresh conversation",
          run: () => void openChatLeaf(app, newChatThreadId()),
        }),
      );
      plugin.register(
        registerChatSlashCommand({
          id: "stop",
          name: "Stop response",
          description: "Interrupt the running response",
          run: () => void app.workspace.getActiveViewOfType(ChatView)?.stopRun(),
        }),
      );
    },
  };
}
