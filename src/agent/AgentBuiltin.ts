import type { App } from "../app/App";
import { writeClipboardText } from "../dom/Clipboard";
import { Notice } from "../ui/Notice";
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
  registerBuiltinToolCards();
  new AgentStatusBar(app);
  app.commands.addCommand({
    id: "agent:open",
    name: "Open chat",
    icon: "lucide-message-circle",
    hotkeys: [{ modifiers: ["Mod", "Shift"], key: "c" }],
    callback: () => void openChatLeaf(app),
  });
  app.commands.addCommand({
    id: "agent:create",
    name: "Create agent",
    icon: "lucide-message-circle-plus",
    callback: () => void openChatLeaf(app, newAgentId()),
  });
  app.commands.addCommand({
    id: "agent:stop",
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
    id: "agent:create-room",
    name: "Create multi-agent room",
    icon: "lucide-users",
    callback: () => void openRoom(app, newRoomId()),
  });

  app.commands.addCommand({
    id: "agent:open-board",
    name: "Open agent board",
    icon: "lucide-layout-grid",
    callback: () => {
      const leaf = app.workspace.getLeavesOfType(AGENT_VIEW_TYPE)[0] ?? app.workspace.getLeaf("tab");
      void leaf.setViewState({ type: AGENT_VIEW_TYPE, active: true }).then(() => app.workspace.revealLeaf(leaf));
    },
  });

  app.commands.addCommand({
    id: "agent:open-properties",
    name: "Open agent properties",
    icon: "lucide-bot",
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
    app.workspace.leftRibbon.addRibbonIcon("lucide-message-circle", "Open chat", () => void openChatLeaf(app), "agent:open");
    app.workspace.leftRibbon.addRibbonIcon("lucide-layout-grid", "Open agents", () => app.commands.executeCommandById("agent:open-board"), "agent:open-board");
  });

  registerChatMessageAction({
    id: "copy",
    title: "Copy",
    run: (message) => {
      void writeClipboardText(chatMessageToMarkdown(message)).then(() => new Notice("Message copied"));
    },
  });
  registerChatMessageAction({
    id: "retry",
    title: "Retry",
    appliesTo: (message) => message.role === "user",
    run: (message, { agent }) => {
      const text = firstTextOf(message);
      if (text) void agent.sendMessage(text).catch((error) => new Notice(`Retry failed: ${error instanceof Error ? error.message : String(error)}`));
    },
  });
  // Edit = refill the composer, the honest v1: the sent message is history
  // and stays; a corrected version goes out as a new message.
  registerChatMessageAction({
    id: "edit",
    title: "Edit",
    appliesTo: (message) => message.role === "user",
    run: (message) => {
      const text = firstTextOf(message);
      const view = app.workspace.getActiveViewOfType(ChatView);
      if (text && view) view.setComposerText(text);
    },
  });

  registerChatSlashCommand({
    id: "new",
    name: "New agent",
    description: "Start a fresh conversation",
    run: () => void openChatLeaf(app, newAgentId()),
  });
  registerChatSlashCommand({
    id: "stop",
    name: "Stop response",
    description: "Interrupt the running response",
    run: () => void app.workspace.getActiveViewOfType(ChatView)?.stopRun(),
  });
}
