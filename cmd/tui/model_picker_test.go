package main

import "testing"

func TestModelPickerItemsKeepModelAndProvider(t *testing.T) {
	items := modelPickerItems([]wireModel{
		{ID: "claude-sonnet", Provider: "anthropic", Name: "Claude Sonnet"},
		{ID: "gpt-5", Provider: "openai"},
	})

	if len(items) != 2 {
		t.Fatalf("len(items) = %d, want 2", len(items))
	}
	if items[0].ID != "anthropic\tclaude-sonnet" {
		t.Fatalf("items[0].ID = %q", items[0].ID)
	}
	if items[0].Label != "Claude Sonnet (anthropic)" {
		t.Fatalf("items[0].Label = %q", items[0].Label)
	}
	if items[1].Label != "gpt-5 (openai)" {
		t.Fatalf("items[1].Label = %q", items[1].Label)
	}

	provider, id, ok := parseModelPickerID(items[0].ID)
	if !ok || provider != "anthropic" || id != "claude-sonnet" {
		t.Fatalf("parseModelPickerID = %q, %q, %v", provider, id, ok)
	}
}
