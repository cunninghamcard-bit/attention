import type { AgentUsage } from "./AgentEvent";

// Every user-facing string in the agent domain lives here — one place to
// review the copy, and the seam a locale layer slots into later. Components
// never hardcode prose; parameterized copy is a function, not a template
// scattered at the call site.
export const STRINGS = {
  composer: {
    modelDefault: "Default",
    send: "Send",
    stop: "Stop",
    attach: "Attach file",
    unknownCommand: (id: string) => `Unknown command /${id}`,
    commandNeedsArgs: (id: string) => `/${id} needs text after it`,
    capabilityMissing: "Not available in this view",
  },
  queued: {
    label: "Queued",
    cancel: "×",
  },
  permission: {
    title: "Permission requested",
    allow: "Allow",
    deny: "Deny",
    outcome: {
      allowed: "allowed",
      denied: "denied",
      timed_out: "timed out",
      cancelled: "cancelled",
    },
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
  artifact: {
    displayText: "Artifact",
    generating: "Generating…",
    open: "Open",
    copy: "Copy",
    save: "Save to vault",
    saved: (path: string) => `Saved to ${path}`,
    saveFailed: (error: string) => `Could not save: ${error}`,
  },
  message: {
    provenance: (model: string, effort?: string) => (effort ? `${model} · ${effort}` : model),
    compacting: "Compacting context…",
    compactFailed: "Context compaction failed",
    forkedFrom: (id: string) => `Forked from ${id} — the agent remembers everything before this line`,
    showMore: "Show more",
    showLess: "Show less",
    runFailed: (error: string) => `Run failed: ${error}`,
    attachmentLines: (lines: number) => `${lines} lines`,
    compacted: "Context compacted",
    compactedTokens: (preTokens: number) => `Context compacted · ${Math.round(preTokens / 1000)}k tokens condensed`,
  },
  room: {
    participants: "Participants",
    invite: "Invite an agent",
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
    model: "Model",
    modelPlaceholder: "engine default",
    effort: "Reasoning effort",
    effortDefault: "Default",
    temperature: "Temperature",
    maxTokens: "Max tokens",
    params: "Parameters",
    addParam: "Add parameter",
    paramKey: "key",
    paramValue: "value",
    configHint: "Stored on the agent row; harnesses consume what they understand.",
    openChat: "Open chat",
    harness: "Harness",
    thinking: "Thinking",
    instructions: "Instructions",
    instructionsPlaceholder: "System prompt for this agent",
    envSection: "Environment",
    envHint: "Values are write-only ($NAME references resolve from the daemon's env). Edit via agent file or CLI.",
    fileOrigin: "Managed by file — edit the agent's .md, the daemon hot-reloads it.",
    editModel: (hint?: string) => (hint ? `Model… (${hint})` : "Model…"),
    memberAgentFor: (id: string) => `Member agent — ${id}`,
    noMembers: "No member agent linked to this thread yet.",
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
    fork: "Fork thread",
    forked: (id: string) => `Forked into ${id}`,
    forkFailed: (error: string) => `Fork failed: ${error}`,
  },
  actions: {
    copy: "Copy",
    retry: "Retry",
    edit: "Edit",
  },
  members: {
    title: "Members",
    add: (label: string) => `Add ${label}`,
    remove: (label: string) => `Remove ${label}`,
    added: (id: string) => `${id} joined the thread`,
    removed: (id: string) => `${id} removed from the thread`,
    empty: "No agents configured yet — create one with the file layer (~/.loom/agents) or the CLI.",
    linkPrompt: "Link an agent…",
  },
  notices: {
    messageCopied: "Message copied",
    conversationCopied: "Conversation copied",
    retryFailed: (error: string) => `Retry failed: ${error}`,
    bridgeUnreachable: (error: string) => `Cannot reach the chat bridge: ${error}`,
    noMemberAgent: "No member agent on this thread — link one first (loom link <agentId> <threadId>).",
    agentSaved: "Agent saved",
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
    steer: "Steer",
    steerDesc: "Interrupt and redirect with new input",
    rename: "Rename",
    renameDesc: "Rename this thread",
    copy: "Copy conversation",
    copyDesc: "Copy the conversation as Markdown",
    delete: "Delete thread",
    deleteDesc: "Delete this thread (asks first)",
    renamed: (title: string) => `Renamed to ${title}`,
    deleted: "Thread deleted",
    steered: "Steering the run",
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
  if (usage.contextTokens && usage.contextWindow) {
    const percent = Math.round((usage.contextTokens / usage.contextWindow) * 100);
    return `${(usage.contextTokens / 1000).toFixed(1)}k / ${Math.round(usage.contextWindow / 1000)}k · ${percent}%${cost}`;
  }
  return `${(usage.totalTokens / 1000).toFixed(1)}k tokens${cost}`;
}

export function formatRelativeTime(timestamp: number): string {
  const deltaSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 60) return "just now";
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h ago`;
  return `${Math.floor(deltaSeconds / 86400)}d ago`;
}
