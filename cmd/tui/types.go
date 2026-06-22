// Adapted from github.com/dimetron/pi-go internal/tui
//
// Only the render-support types referenced by the copied render layer are kept.
// The coupled symbols from pi-go's types.go (Config, InitResult,
// AgentSubEvent-channel plumbing, CompactStatsProvider, ModelSwitcher, etc.)
// are intentionally omitted — this is a viewer, not the full agent host.
package main

// TokenTracker provides read access to daily token usage for the status bar.
// The viewer never wires a real tracker (status.go tolerates a nil
// TokenTracker), but the copied status.go's StatusRenderInput references the
// interface, so the minimal contract is reproduced here verbatim.
type TokenTracker interface {
	Limit() int64
	Remaining() int64     // -1 if unlimited
	PercentUsed() float64 // 0-100+
	TotalUsed() int64     // total tokens consumed today

	// Session context window tracking.
	LastPromptTokens() int64     // most recent prompt tokens from LLM response
	ContextWindowSize() int64    // model's context window size (0 = unknown)
	ContextPercentUsed() float64 // context window usage 0-100+
}
