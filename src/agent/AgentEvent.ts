export type ChatRole = "user" | "assistant";

export type ChatPartType = "text" | "thinking" | "tool" | "attachment";

export type AgentRunStatus = "completed" | "error" | "aborted";

interface AgentEventBase {
  seq: number;
  agentId: string;
  // Producer clock, epoch ms. Stamped by the bridge so history replay keeps
  // real timing (durations, timestamps) instead of arrival time.
  ts?: number;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd?: number;
  // Occupancy of the context window: contextTokens is the LAST turn's total
  // (accumulated totals double-count re-sent context); contextWindow is the
  // model's capacity. Both engine-provided; absent when unknown.
  contextTokens?: number;
  contextWindow?: number;
}

export interface AgentRunStartedEvent extends AgentEventBase {
  type: "run.started";
  runId: string;
}

// In a multi-agent room several assistants share one stream; authorId /
// authorName say who is speaking. Absent on user messages and in
// single-agent chats.
export interface AgentMessageStartedEvent extends AgentEventBase {
  type: "message.started";
  messageId: string;
  role: ChatRole;
  authorId?: string;
  authorName?: string;
}

export interface AgentPartOpenedEvent extends AgentEventBase {
  type: "part.opened";
  messageId: string;
  partIndex: number;
  partType: ChatPartType;
  toolName?: string;
  name?: string;
}

export interface AgentPartDeltaEvent extends AgentEventBase {
  type: "part.delta";
  messageId: string;
  partIndex: number;
  delta: string;
}

// A second part.closed on an already-closed tool part merges its result;
// tool results arrive after the tool_use block has closed. A failed tool
// execution carries `error` (presence means failed).
export interface AgentPartClosedEvent extends AgentEventBase {
  type: "part.closed";
  messageId: string;
  partIndex: number;
  result?: string;
  error?: string;
}

export interface AgentMessageClosedEvent extends AgentEventBase {
  type: "message.closed";
  messageId: string;
}

export interface AgentRunClosedEvent extends AgentEventBase {
  type: "run.closed";
  runId: string;
  status: AgentRunStatus;
  error?: string;
  usage?: AgentUsage;
}

// The engine condensed earlier conversation to fit its context window; the
// UI marks where history stopped being verbatim.
export interface AgentContextCompactedEvent extends AgentEventBase {
  type: "context.compacted";
  afterMessageId?: string;
  preTokens?: number;
  trigger?: string;
}

// The engine wants to run a tool that needs approval; the UI blocks on a
// card until permission.resolved arrives (from the user's decision or a
// kernel-side timeout/cancellation).
export interface AgentPermissionRequestedEvent extends AgentEventBase {
  type: "permission.requested";
  requestId: string;
  toolName: string;
  input?: string;
}

export interface AgentPermissionResolvedEvent extends AgentEventBase {
  type: "permission.resolved";
  requestId: string;
  outcome: "allowed" | "denied" | "timed_out" | "cancelled";
}

export type AgentEvent =
  | AgentRunStartedEvent
  | AgentMessageStartedEvent
  | AgentPartOpenedEvent
  | AgentPartDeltaEvent
  | AgentPartClosedEvent
  | AgentMessageClosedEvent
  | AgentRunClosedEvent
  | AgentContextCompactedEvent
  | AgentPermissionRequestedEvent
  | AgentPermissionResolvedEvent;
