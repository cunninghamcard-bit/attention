package session

import (
	"context"
	"testing"
)

func TestInMemorySessionMetadata(t *testing.T) {
	s := NewInMemorySession("/work/dir")
	meta := s.GetMetadata()
	if meta.CWD != "/work/dir" {
		t.Fatalf("cwd = %q, want /work/dir", meta.CWD)
	}
	if meta.ID == "" {
		t.Fatal("expected a generated id, got empty")
	}
	if meta.Path != "" {
		t.Fatalf("ephemeral session should have no path, got %q", meta.Path)
	}
}

func TestInMemorySessionAppendGetEntriesRoundtrip(t *testing.T) {
	ctx := context.Background()
	s := NewInMemorySession("/work/dir")

	if _, err := s.AppendMessage(ctx, userMessage("hello")); err != nil {
		t.Fatalf("AppendMessage user: %v", err)
	}
	if _, err := s.AppendModelChange(ctx, "openai", "gpt-4"); err != nil {
		t.Fatalf("AppendModelChange: %v", err)
	}
	if _, err := s.AppendThinkingLevelChange(ctx, "high"); err != nil {
		t.Fatalf("AppendThinkingLevelChange: %v", err)
	}
	assistantID, err := s.AppendMessage(ctx, assistantMessage("anthropic", "claude", "hi"))
	if err != nil {
		t.Fatalf("AppendMessage assistant: %v", err)
	}

	entries := s.GetEntries()
	if len(entries) != 4 {
		t.Fatalf("entries len = %d, want 4", len(entries))
	}

	// GetEntry roundtrip on the assistant message.
	got, ok := s.GetEntry(assistantID)
	if !ok {
		t.Fatalf("GetEntry(%s) not found", assistantID)
	}
	if got.Type != "message" {
		t.Fatalf("entry type = %q, want message", got.Type)
	}

	// BuildContext should reconstruct the conversation from the in-memory tree.
	gotCtx, err := s.BuildContext(ctx)
	if err != nil {
		t.Fatalf("BuildContext: %v", err)
	}
	if len(gotCtx.Messages) != 2 {
		t.Fatalf("messages len = %d, want 2", len(gotCtx.Messages))
	}
	if gotCtx.ThinkingLevel != "high" {
		t.Fatalf("thinking level = %q, want high", gotCtx.ThinkingLevel)
	}
	if gotCtx.Model == nil || gotCtx.Model.Provider != "anthropic" || gotCtx.Model.ModelID != "claude" {
		t.Fatalf("model = %+v, want anthropic/claude", gotCtx.Model)
	}
}

func TestInMemorySessionLeafTracking(t *testing.T) {
	ctx := context.Background()
	s := NewInMemorySession("/work/dir")

	firstID, err := s.AppendMessage(ctx, userMessage("first"))
	if err != nil {
		t.Fatalf("AppendMessage: %v", err)
	}
	leaf, err := s.GetLeafID()
	if err != nil {
		t.Fatalf("GetLeafID: %v", err)
	}
	if leaf == nil || *leaf != firstID {
		t.Fatalf("leaf = %v, want %s", leaf, firstID)
	}
}
