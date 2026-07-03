// The engine kernel: the one interface every backend speaks. An engine's
// whole job is fn1 — turn a prompt into canonical events (AgentEvent.ts
// shapes, minus seq/agentId which the bridge stamps). The bridge owns
// threads, HTTP, SSE and user-message echoing; engines own nothing but
// their own sessions. along-go's Worker implements this same interface in
// Go; Codex or any future engine slots in by implementing it here.
//
// No switching UI yet — the engine is picked once at bridge startup. The
// seam is the point: the frontend cannot tell engines apart, by design.

export interface EngineEmit {
  (event: { type: string; [key: string]: unknown }): void;
}

export interface EngineRunInput {
  agentId: string;
  runId: string;
  prompt: string;
  emit: EngineEmit;
}

export interface Engine {
  readonly name: string;
  // Emits events for the run, including its own run.closed (engines know
  // their real completion status; the bridge does not).
  run(input: EngineRunInput): Promise<void>;
  // Best effort interrupt; stopping an idle agent is a no-op.
  stop(agentId: string): void;
}
