import type { AgentUsage } from "./AgentEvent";

// Every user-facing string in the agent domain lives here — one place to
// review the copy, and the seam a locale layer slots into later. Components
// never hardcode prose; parameterized copy is a function, not a template
// scattered at the call site.
export const STRINGS = {
  composer: {
    placeholder: "Message… (/ for commands, [[ for notes)",
    hint: "Enter to send · Shift+Enter for a new line · / commands",
    send: "Send",
    stop: "Stop",
  },
  empty: {
    title: "Start a conversation",
    hint: "Type a message below, or / for commands.",
  },
  role: {
    you: "You",
    assistant: "Assistant",
  },
  thinking: {
    active: (elapsedSeconds: number | null) =>
      `Thinking…${elapsedSeconds !== null && elapsedSeconds >= 2 ? ` ${Math.round(elapsedSeconds)}s` : ""}`,
    done: (elapsedSeconds: number | null) =>
      `Thought${elapsedSeconds !== null ? ` · ${elapsedSeconds.toFixed(1)}s` : ""}`,
  },
  tool: {
    running: "running",
    done: "done",
    called: "called",
    failed: "failed",
  },
  timeline: {
    summary: (total: number, status: string, durationSeconds: number | null) =>
      `${total} tool call${total === 1 ? "" : "s"} · ${status}${durationSeconds !== null ? ` · ${durationSeconds.toFixed(1)}s` : ""}`,
    failedStatus: (count: number) => `${count} failed`,
  },
  message: {
    showMore: "Show more",
    showLess: "Show less",
    runFailed: (error: string) => `Run failed: ${error}`,
    attachmentLines: (lines: number) => `${lines} lines`,
    compacted: "Context compacted",
    compactedTokens: (preTokens: number) => `Context compacted · ${Math.round(preTokens / 1000)}k tokens condensed`,
  },
  room: {
    participants: "Participants",
    participantsHint: "Agents join as they speak.",
    title: "Room",
    titleFor: (roomId: string) => `Room – ${roomId}`,
  },
  board: {
    title: "Agents",
    displayText: "Agent board",
    newAgent: "New agent",
    newRoom: "New room",
    empty: "No agents yet. Create one to get started.",
    openChat: "Chat",
    openRoom: "Room",
    openProperties: "Properties",
  },
  agentState: {
    running: "Running",
    idle: "Idle",
  },
  properties: {
    displayText: "Agent",
    displayTextFor: (agentId: string) => `Agent – ${agentId}`,
    none: "No agent selected.",
    identity: "Identity",
    status: "Status",
    activity: "Activity",
    configuration: "Configuration",
    actions: "Actions",
    id: "ID",
    state: "State",
    lastError: "Last error",
    messages: "Messages",
    compactions: "Compactions",
    lastRun: "Last run",
    configHint: "Engine and model configuration arrives with the Go backend.",
    openChat: "Open chat",
  },
  menu: {
    properties: "Properties",
    rename: "Rename",
    renamePrompt: "Rename agent",
    delete: "Delete",
    deleteConfirm: (name: string) => `Delete agent "${name}"? Its history goes with it.`,
    agentProperties: "Agent properties",
    newAgent: "New agent",
    copyConversation: "Copy conversation",
  },
  actions: {
    copy: "Copy",
    retry: "Retry",
    edit: "Edit",
  },
  notices: {
    messageCopied: "Message copied",
    conversationCopied: "Conversation copied",
    retryFailed: (error: string) => `Retry failed: ${error}`,
    bridgeUnreachable: (error: string) => `Cannot reach the chat bridge: ${error}`,
  },
  commands: {
    openChat: "Open chat",
    createAgent: "Create agent",
    stopResponse: "Stop chat response",
    createRoom: "Create multi-agent room",
    openBoard: "Open agent board",
    openAgents: "Open agents",
    openProperties: "Open agent properties",
  },
  slash: {
    newAgent: "New agent",
    newAgentDesc: "Start a fresh conversation",
    stop: "Stop response",
    stopDesc: "Interrupt the running response",
  },
  chat: {
    displayText: "Chat",
    displayTextFor: (agentId: string) => `Chat – ${agentId}`,
  },
  settings: {
    engineHeading: "Engine",
    bridgeUrl: "Bridge URL",
    bridgeUrlDesc: "REST + SSE endpoint of the chat bridge. Applies to newly opened threads.",
    chatHeading: "Chat",
    typewriter: "Typewriter reveal",
    typewriterDesc: "Pace streamed text at a smooth reading rate. Off shows deltas the moment they arrive.",
    collapseThinking: "Collapse finished thinking",
    collapseThinkingDesc: "Fold reasoning to its header once it completes. Off keeps it expanded.",
    composerHeading: "Composer",
    pasteThreshold: "Paste-to-card threshold",
    pasteThresholdDesc: (defaultValue: number) =>
      `Pasted text with at least this many lines becomes an attachment card instead of inline text. Default ${defaultValue}.`,
  },
};

export function formatUsage(usage: AgentUsage): string {
  const cost = usage.costUsd ? ` · $${usage.costUsd.toFixed(3)}` : "";
  return `${(usage.totalTokens / 1000).toFixed(1)}k tokens${cost}`;
}

export function formatRelativeTime(timestamp: number): string {
  const deltaSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 60) return "just now";
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h ago`;
  return `${Math.floor(deltaSeconds / 86400)}d ago`;
}
