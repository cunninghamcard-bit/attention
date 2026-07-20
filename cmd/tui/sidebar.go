// Adapted from github.com/dimetron/pi-go internal/tui
package main

import (
	"fmt"
	"path/filepath"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/mattn/go-runewidth"
)

// SidebarWidth is the fixed width of the right sidebar.
const SidebarWidth = 30

// SidebarRenderInput provides data needed by the sidebar.
type SidebarRenderInput struct {
	Width        int
	Height       int
	Eyes         string
	Mascot       string // full 3-line mascot face (mutually exclusive with Eyes)
	ProviderName string
	ModelName    string
	GitBranch    string
	DiffAdded    int
	DiffRemoved  int
	Running      bool
	TokenTracker TokenTracker
	AppVersion   string
	HostName     string
	FolderName   string
	Messages     []message
	ActiveTool   string
	LoadingItems map[string]bool
	MatrixLines  string  // pre-rendered matrix rain (2 lines)
	StatusLine   string  // status text shown above matrix
	Skills       []Skill // skills section; nil/empty = hidden
}

// RenderSidebar renders the right sidebar panel.
func RenderSidebar(in SidebarRenderInput) string {
	w := in.Width
	if w < 10 {
		w = 10
	}

	fg := lipgloss.Color("#cdd6f4")        // Mocha text
	dimFg := lipgloss.Color("#a6adc8")     // Mocha subtext0
	borderFg := lipgloss.Color("#45475a")  // Mocha surface1
	headingFg := lipgloss.Color("#89b4fa") // Mocha blue

	dim := lipgloss.NewStyle().Foreground(dimFg)
	heading := lipgloss.NewStyle().Foreground(headingFg).Bold(true)
	bright := lipgloss.NewStyle().Foreground(fg)
	_ = bright

	innerW := w - 3 // padding + border

	var lines []string

	// --- Eyes / mood ---
	if in.Mascot != "" {
		mascotStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#74c7ec")) // Mocha sapphire
		moodLine := mascotStyle.Render(fmt.Sprintf("  %s", in.Mascot))
		lines = append(lines, "", moodLine, "")
	} else if in.Eyes != "" {
		eyeStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#74c7ec")) // Mocha sapphire
		moodLine := eyeStyle.Render(fmt.Sprintf("  %s", in.Eyes))
		lines = append(lines, "", moodLine, "")
	}

	sidebarBg := lipgloss.Color("#11111bcc") // Catppuccin Mocha crust with alpha for dark transparency

	// --- Context section (session context window usage) ---
	lines = append(lines, heading.Render("  Context"))
	if tt := in.TokenTracker; tt != nil && tt.ContextWindowSize() > 0 {
		// Known context window: show prompt tokens / window size with bar.
		promptTokens := tt.LastPromptTokens()
		ctxWindow := tt.ContextWindowSize()
		pct := tt.ContextPercentUsed()
		lines = append(lines, dim.Render(fmt.Sprintf("  %s / %s",
			formatTokenCount(promptTokens), formatTokenCount(ctxWindow))))
		lines = append(lines, "  "+renderContextBar(pct, sidebarBg))
	} else if tt := in.TokenTracker; tt != nil && tt.LastPromptTokens() > 0 {
		// Unknown window but have actual prompt tokens from LLM.
		lines = append(lines, dim.Render(fmt.Sprintf("  %s tokens",
			formatTokenCount(tt.LastPromptTokens()))))
	} else {
		// No LLM response yet: estimate from message chars.
		ctxChars := 0
		for _, msg := range in.Messages {
			ctxChars += len(msg.content) + len(msg.tool) + len(msg.toolIn)
		}
		ctxTokens := ctxChars / 4
		if ctxTokens >= 1000 {
			lines = append(lines, dim.Render(fmt.Sprintf("  ~%.1fk tokens", float64(ctxTokens)/1000)))
		} else {
			lines = append(lines, dim.Render(fmt.Sprintf("  ~%d tokens", ctxTokens)))
		}
	}
	lines = append(lines, "")

	// --- Model section ---
	lines = append(lines, heading.Render("  Model"))
	if in.ProviderName != "" {
		lines = append(lines, dim.Render("  "+in.ProviderName))
	}
	if in.ModelName != "" {
		name := in.ModelName
		if len(name) > innerW {
			name = name[:innerW-1] + "…"
		}
		lines = append(lines, dim.Render("  "+name))
	}
	lines = append(lines, "")

	// --- Git section ---
	if in.GitBranch != "" {
		lines = append(lines, heading.Render("  Git"))
		lines = append(lines, dim.Render(fmt.Sprintf("  ⎇ %s", in.GitBranch)))
		if in.DiffAdded > 0 || in.DiffRemoved > 0 {
			addStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#a6e3a1"))
			delStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#f38ba8"))
			lines = append(lines, "  "+
				addStyle.Render(fmt.Sprintf("+%d", in.DiffAdded))+
				dim.Render(" ")+
				delStyle.Render(fmt.Sprintf("-%d", in.DiffRemoved)))
		}
		lines = append(lines, "")
	}

	if in.Running {
		lines = append(lines, heading.Render("  Status"))
		if in.ActiveTool != "" {
			lines = append(lines, dim.Render("  ⚡ "+in.ActiveTool))
		} else {
			lines = append(lines, dim.Render("  thinking..."))
		}
		lines = append(lines, "")
	}

	// --- Agents / MCP-Tools sections removed (services cut in Phase 1) ---

	// --- Skills section ---
	// Faithful port of pi-go's sidebar.go Skills section (yellow bold
	// "Skills [N]" heading), adapted to the local Skill type and extended to
	// list each skill name so the loaded skills are visible.
	if len(in.Skills) > 0 {
		skillsHeading := lipgloss.NewStyle().Foreground(lipgloss.Color("#f9e2af")).Bold(true) // Mocha yellow
		lines = append(lines, skillsHeading.Render(fmt.Sprintf("  Skills [%d]", len(in.Skills))))
		for _, s := range in.Skills {
			name := s.Name
			maxName := innerW - 4 // room for "  · " prefix
			if maxName < 6 {
				maxName = 6
			}
			if len(name) > maxName {
				name = name[:maxName-1] + "…"
			}
			lines = append(lines, dim.Render("  · "+name))
		}
		lines = append(lines, "")
	}

	// --- Loading section ---
	if in.LoadingItems != nil {
		lines = append(lines, heading.Render("  Loading"))
		for _, name := range sortedKeys(in.LoadingItems) {
			if in.LoadingItems[name] {
				okStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#a6e3a1"))
				lines = append(lines, okStyle.Render("  ✓ "+name))
			} else {
				loadStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#fab387"))
				lines = append(lines, loadStyle.Render("  ◌ "+name+"..."))
			}
		}
		lines = append(lines, "")
	}

	// Join content and pad to fill height, reserving 3 lines for status + matrix.
	hasMatrix := in.MatrixLines != ""
	matrixH := 0
	statusH := 0
	if hasMatrix {
		matrixH = matrixLines
		statusH = 1 // 1 line for status separator
	}
	content := strings.Join(lines, "\n")
	contentLines := strings.Split(content, "\n")
	targetH := in.Height - matrixH - statusH
	if len(contentLines) < targetH {
		// Fill remaining space with subtle dim separators or spacer text.
		fillerStyle := lipgloss.NewStyle().Foreground(dimFg)
		for len(contentLines) < targetH {
			contentLines = append(contentLines, fillerStyle.Render("  ···"))
		}
	}
	if len(contentLines) > targetH {
		contentLines = contentLines[:targetH]
	}

	// Add status separator line above matrix (if active).
	if hasMatrix {
		statusStyle := lipgloss.NewStyle().Foreground(dimFg)
		statusText := in.StatusLine
		if statusText == "" {
			statusText = "──── tokens ────"
		}
		// Truncate status text to fit (rune-safe)
		maxStatusW := w - 4
		if runewidth.StringWidth(statusText) > maxStatusW {
			statusText = runewidth.Truncate(statusText, maxStatusW-1, "─")
		}
		contentLines = append(contentLines, statusStyle.Render(statusText))
		contentLines = append(contentLines, strings.Split(in.MatrixLines, "\n")...)
	}
	content = strings.Join(contentLines, "\n")

	// Wrap in a styled box with dark transparent background and
	// left border to separate from main panel.
	box := lipgloss.NewStyle().
		Width(w).
		Background(sidebarBg).
		BorderStyle(lipgloss.Border{Left: "│"}).
		BorderLeft(true).
		BorderForeground(borderFg)

	return box.Render(content)
}

func sidebarFolderName(workDir string) string {
	if workDir == "" {
		return ""
	}
	return filepath.Base(filepath.Clean(workDir))
}
