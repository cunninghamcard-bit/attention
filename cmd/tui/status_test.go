package main

import (
	"regexp"
	"strings"
	"testing"
)

var ansiPattern = regexp.MustCompile(`\x1b\[[0-9;:]*m`)

func TestStatusDoesNotInventChatMode(t *testing.T) {
	s := StatusModel{Width: 80}

	out := s.Render(StatusRenderInput{ModelName: "claude"})
	if strings.Contains(out, "chat") {
		t.Fatalf("status rendered unsupported chat mode: %q", out)
	}
}

func TestSidebarDoesNotInventChatMode(t *testing.T) {
	out := RenderSidebar(SidebarRenderInput{
		Width:     30,
		Height:    20,
		ModelName: "claude",
	})
	plain := ansiPattern.ReplaceAllString(out, "")
	if strings.Contains(plain, "│  Mode ") || strings.Contains(plain, "[chat") {
		t.Fatalf("sidebar rendered unsupported mode state: %q", out)
	}
}

func TestStartupLineUsesAttentionName(t *testing.T) {
	out := renderStartupMatrixLine(0, "", nil, 0)
	if strings.Contains(out, "Loading Pi") || !strings.Contains(out, "Loading Attention") {
		t.Fatalf("startup line = %q", out)
	}
}
