export type ChatRole = "user" | "assistant";

export type ChatPartType = "text" | "thinking" | "tool" | "attachment";

export type ChatRunStatus = "completed" | "error" | "aborted";

interface ChatEventBase {
  seq: number;
  threadId: string;
}

export interface ChatRunStartedEvent extends ChatEventBase {
  type: "run.started";
  runId: string;
}

export interface ChatMessageStartedEvent extends ChatEventBase {
  type: "message.started";
  messageId: string;
  role: ChatRole;
}

export interface ChatPartOpenedEvent extends ChatEventBase {
  type: "part.opened";
  messageId: string;
  partIndex: number;
  partType: ChatPartType;
  toolName?: string;
  name?: string;
}

export interface ChatPartDeltaEvent extends ChatEventBase {
  type: "part.delta";
  messageId: string;
  partIndex: number;
  delta: string;
}

// A second part.closed on an already-closed tool part merges its result;
// tool results arrive after the tool_use block has closed.
export interface ChatPartClosedEvent extends ChatEventBase {
  type: "part.closed";
  messageId: string;
  partIndex: number;
  result?: string;
}

export interface ChatMessageClosedEvent extends ChatEventBase {
  type: "message.closed";
  messageId: string;
}

export interface ChatRunClosedEvent extends ChatEventBase {
  type: "run.closed";
  runId: string;
  status: ChatRunStatus;
  error?: string;
}

export type ChatEvent =
  | ChatRunStartedEvent
  | ChatMessageStartedEvent
  | ChatPartOpenedEvent
  | ChatPartDeltaEvent
  | ChatPartClosedEvent
  | ChatMessageClosedEvent
  | ChatRunClosedEvent;
