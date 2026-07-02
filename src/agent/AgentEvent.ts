export type ChatRole = "user" | "assistant";

export type ChatPartType = "text" | "thinking" | "tool" | "attachment";

export type AgentRunStatus = "completed" | "error" | "aborted";

interface AgentEventBase {
  seq: number;
  agentId: string;
}

export interface AgentRunStartedEvent extends AgentEventBase {
  type: "run.started";
  runId: string;
}

export interface AgentMessageStartedEvent extends AgentEventBase {
  type: "message.started";
  messageId: string;
  role: ChatRole;
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
// tool results arrive after the tool_use block has closed.
export interface AgentPartClosedEvent extends AgentEventBase {
  type: "part.closed";
  messageId: string;
  partIndex: number;
  result?: string;
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
}

// The engine condensed earlier conversation to fit its context window; the
// UI marks where history stopped being verbatim.
export interface AgentContextCompactedEvent extends AgentEventBase {
  type: "context.compacted";
  afterMessageId?: string;
  preTokens?: number;
  trigger?: string;
}

export type AgentEvent =
  | AgentRunStartedEvent
  | AgentMessageStartedEvent
  | AgentPartOpenedEvent
  | AgentPartDeltaEvent
  | AgentPartClosedEvent
  | AgentMessageClosedEvent
  | AgentRunClosedEvent
  | AgentContextCompactedEvent;
