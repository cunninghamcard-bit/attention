import type { App } from "../app/App";
import { writeClipboardText } from "../dom/Clipboard";
import { addIcon } from "../ui/Icon";
import { STRINGS } from "./AgentStrings";
import { Notice } from "../ui/Notice";

// Lucide glyphs the vendored icon registry does not carry; agent surfaces
// (ribbon, commands, views, empty state) use them. Registered through the
// public addIcon channel (unprefixed: the lucide- namespace resolves
// builtin-only, by parity) — drop these when the registry re-vendors them.
function ensureAgentIcons(): void {
  addIcon("message-circle", '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>');
  addIcon("message-circle-plus", '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M8 12h8"/><path d="M12 8v8"/>');
  addIcon("bot", '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>');
  addIcon("users", '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>');
}
import { newAgentId } from "./AgentManager";
import { registerChatMessageAction, registerChatSlashCommand } from "./ChatRegistry";
import { registerBuiltinToolCards } from "./ChatToolCards";
import { AgentStatusBar } from "./AgentStatusBar";
import { chatMessageToMarkdown, type ChatMessage } from "./Agent";

function firstTextOf(message: ChatMessage): string {
  const part = message.parts.find((item) => item?.type === "text");
  return part && "markdown" in part ? part.markdown : "";
}
import { AgentPropertiesView, AGENT_PROPERTIES_VIEW_TYPE } from "./AgentPropertiesView";
import { AgentView, AGENT_VIEW_TYPE } from "./AgentView";
import { ChatView, CHAT_VIEW_TYPE } from "./ChatView";
import { MultiAgentView, MULTI_AGENT_VIEW_TYPE } from "./MultiAgentView";

// Rooms live in the same id space as agents, distinguished by prefix: the
// bridge treats a room as one more event stream.
export function newRoomId(): string {
  return newAgentId().replace("agent-", "room-");
}

export async function openRoom(app: App, roomId: string): Promise<void> {
  const leaves = app.workspace.getLeavesOfType(MULTI_AGENT_VIEW_TYPE);
  const showing = leaves.find((leaf) => (leaf.view as MultiAgentView | null)?.getState()?.agentId === roomId);
  const leaf = showing ?? app.workspace.getLeaf("tab");
  await leaf.setViewState({ type: MULTI_AGENT_VIEW_TYPE, active: true, state: { agentId: roomId } });
  await app.workspace.revealLeaf(leaf);
}

// Opens the agent's properties view, reusing a leaf already showing it.
export async function openAgentProperties(app: App, agentId: string): Promise<void> {
  const leaves = app.workspace.getLeavesOfType(AGENT_PROPERTIES_VIEW_TYPE);
  const showing = leaves.find((leaf) => (leaf.view as AgentPropertiesView | null)?.getState()?.agentId === agentId);
  const leaf = showing ?? leaves[0] ?? app.workspace.getLeaf("tab");
  await leaf.setViewState({ type: AGENT_PROPERTIES_VIEW_TYPE, active: true, state: { agentId } });
  await app.workspace.revealLeaf(leaf);
}

// Opens a specific thread, preferring a leaf that already shows it, then the
// active chat leaf, then any chat leaf, then a new tab.
export async function openAgent(app: App, agentId: string): Promise<void> {
  const leaves = app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
  const showing = leaves.find((leaf) => (leaf.view as ChatView | null)?.getState()?.agentId === agentId);
  const leaf = showing ?? app.workspace.getActiveViewOfType(ChatView)?.leaf ?? leaves[0] ?? app.workspace.getLeaf("tab");
  await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true, state: { agentId } });
  await app.workspace.revealLeaf(leaf);
}

async function openChatLeaf(app: App, agentId?: string): Promise<void> {
  if (agentId) {
    await openAgent(app, agentId);
    return;
  }
  const leaf = app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0] ?? app.workspace.getLeaf("tab");
  await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
  await app.workspace.revealLeaf(leaf);
}

// Chat is the app's default strong view — MarkdownView-tier, not a togglable
// core plugin. The view type registers with the other builtin views; the
// command/ribbon/slash surface registers once the workspace exists.
export function registerAgentViews(app: App): void {
  app.viewRegistry.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf));
  app.viewRegistry.registerView(AGENT_PROPERTIES_VIEW_TYPE, (leaf) => new AgentPropertiesView(leaf));
  app.viewRegistry.registerView(AGENT_VIEW_TYPE, (leaf) => new AgentView(leaf));
  app.viewRegistry.registerView(MULTI_AGENT_VIEW_TYPE, (leaf) => new MultiAgentView(leaf));
}

export function registerAgentBuiltin(app: App): void {
  ensureAgentIcons();
  registerBuiltinToolCards();
  new AgentStatusBar(app);
  app.commands.addCommand({
    id: "agent:open",
    name: STRINGS.commands.openChat,
    icon: "message-circle",
    hotkeys: [{ modifiers: ["Mod", "Shift"], key: "c" }],
    callback: () => void openChatLeaf(app),
  });
  app.commands.addCommand({
    id: "agent:create",
    name: STRINGS.commands.createAgent,
    icon: "message-circle-plus",
    callback: () => void openChatLeaf(app, newAgentId()),
  });
  app.commands.addCommand({
    id: "agent:stop",
    name: STRINGS.commands.stopResponse,
    icon: "lucide-square",
    checkCallback: (checking) => {
      const view = app.workspace.getActiveViewOfType(ChatView);
      const running = Boolean(view?.isRunning());
      if (!checking && running) void view?.stopRun();
      return running;
    },
  });

  app.commands.addCommand({
    id: "agent:create-room",
    name: STRINGS.commands.createRoom,
    icon: "users",
    callback: () => void openRoom(app, newRoomId()),
  });

  app.commands.addCommand({
    id: "agent:open-board",
    name: STRINGS.commands.openBoard,
    icon: "lucide-layout-grid",
    callback: () => {
      const leaf = app.workspace.getLeavesOfType(AGENT_VIEW_TYPE)[0] ?? app.workspace.getLeaf("tab");
      void leaf.setViewState({ type: AGENT_VIEW_TYPE, active: true }).then(() => app.workspace.revealLeaf(leaf));
    },
  });

  app.commands.addCommand({
    id: "agent:open-properties",
    name: STRINGS.commands.openProperties,
    icon: "bot",
    checkCallback: (checking) => {
      const view = app.workspace.getActiveViewOfType(ChatView);
      const agentId = view ? String(view.getState().agentId ?? "") : "";
      if (!checking && agentId) void openAgentProperties(app, agentId);
      return Boolean(agentId);
    },
  });

  // After layout-ready, like core plugin ribbon items: the ribbon stays
  // pristine during workspace construction and layout deserialization.
  app.workspace.onLayoutReady(() => {
    app.workspace.leftRibbon.addRibbonIcon("message-circle", STRINGS.commands.openChat, () => void openChatLeaf(app), "agent:open");
    app.workspace.leftRibbon.addRibbonIcon("lucide-layout-grid", STRINGS.commands.openAgents, () => app.commands.executeCommandById("agent:open-board"), "agent:open-board");
  });

  registerChatMessageAction({
    id: "copy",
    title: STRINGS.actions.copy,
    run: (message) => {
      void writeClipboardText(chatMessageToMarkdown(message)).then(() => new Notice(STRINGS.notices.messageCopied));
    },
  });
  registerChatMessageAction({
    id: "retry",
    title: STRINGS.actions.retry,
    appliesTo: (message) => message.role === "user",
    run: (message, { agent }) => {
      const text = firstTextOf(message);
      if (text) void agent.sendMessage(text).catch((error) => new Notice(STRINGS.notices.retryFailed(error instanceof Error ? error.message : String(error))));
    },
  });
  // Edit = refill the composer, the honest v1: the sent message is history
  // and stays; a corrected version goes out as a new message.
  registerChatMessageAction({
    id: "edit",
    title: STRINGS.actions.edit,
    appliesTo: (message) => message.role === "user",
    run: (message) => {
      const text = firstTextOf(message);
      const view = app.workspace.getActiveViewOfType(ChatView);
      if (text && view) view.setComposerText(text);
    },
  });

  registerChatSlashCommand({
    id: "new",
    name: STRINGS.slash.newAgent,
    description: STRINGS.slash.newAgentDesc,
    run: () => void openChatLeaf(app, newAgentId()),
  });
  registerChatSlashCommand({
    id: "stop",
    name: STRINGS.slash.stop,
    description: STRINGS.slash.stopDesc,
    run: () => void app.workspace.getActiveViewOfType(ChatView)?.stopRun(),
  });
}
