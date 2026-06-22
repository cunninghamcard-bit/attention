// Command attention-tui is a minimal terminal viewer for the Attention agent
// kernel (`along`). It reuses pi-go's decoupled render layer (chat / tool
// display / status / theme / layout / spinner — all copied verbatim and
// attributed) and drives it with the kernel's newline-delimited JSON rpc
// protocol.
//
// It is intentionally a viewer: a prompt input, a streaming chat transcript,
// tool-call lines, and a status bar. No slash commands, sessions UI, or model
// switcher.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"

	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/charmbracelet/glamour"
)

// rpcEventMsg wraps an RPCClient event so it can flow through the tea loop.
type rpcEventMsg struct{ ev Event }

// model is the bubbletea root: copied ChatModel + StatusModel + a bubbles
// textinput, plus the rpc client and a few flags of run state.
type model struct {
	chat   ChatModel
	status StatusModel
	input  textinput.Model
	rpc    *RPCClient

	layout    Layout
	width     int
	height    int
	running   bool // a turn is in flight
	quitting  bool
	modelName string
}

// newModel builds the root model with a fresh glamour renderer and a focused
// textinput. The rpc client is attached separately so View renders an empty
// chat even before the kernel produces any output.
func newModel(rpc *RPCClient, modelName string) *model {
	renderer, _ := glamour.NewTermRenderer(
		glamour.WithAutoStyle(),
		glamour.WithWordWrap(80),
		glamour.WithEmoji(),
	)
	ti := textinput.New()
	ti.Prompt = "> "
	ti.Placeholder = "Ask the agent anything..."
	ti.SetVirtualCursor(false)
	_ = ti.Focus()

	return &model{
		chat:      NewChatModel(renderer),
		status:    StatusModel{},
		input:     ti,
		rpc:       rpc,
		modelName: modelName,
	}
}

func (m *model) Init() tea.Cmd {
	return m.waitForEvent()
}

// waitForEvent reads one event from the rpc channel and re-injects it as a
// tea.Msg. Returning a fresh command after each event keeps the pump running.
func (m *model) waitForEvent() tea.Cmd {
	ch := m.rpc.Events
	return func() tea.Msg {
		ev, ok := <-ch
		if !ok {
			return rpcEventMsg{ev: Event{Kind: EvKernelExit}}
		}
		return rpcEventMsg{ev: ev}
	}
}

func (m *model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.layout = NewLayout(msg.Width, msg.Height)
		m.chat.UpdateRenderer(m.layout.ChatWidth())
		m.status.Width = m.layout.StatusWidth()
		m.input.SetWidth(max(0, msg.Width-4))
		return m, nil

	case tea.KeyPressMsg:
		return m.handleKey(msg)

	case rpcEventMsg:
		return m.handleEvent(msg.ev)
	}

	// Forward anything else (paste, etc.) to the input when idle.
	if !m.running {
		var cmd tea.Cmd
		m.input, cmd = m.input.Update(msg)
		return m, cmd
	}
	return m, nil
}

func (m *model) handleKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	key := msg.Key()

	// Ctrl+C / Ctrl+D quit immediately, killing the child.
	if key.Mod == tea.ModCtrl && (key.Code == 'c' || key.Code == 'd') {
		m.quitting = true
		m.rpc.Close()
		return m, tea.Quit
	}

	// While a turn runs, ignore editing keys (viewer is read-only mid-turn).
	if m.running {
		return m, nil
	}

	if key.Code == tea.KeyEnter {
		text := strings.TrimSpace(m.input.Value())
		if text == "" {
			return m, nil
		}
		// Append the user's message, send it, clear the box, mark running.
		m.chat.Messages = append(m.chat.Messages, message{role: "user", content: text})
		m.chat.ResetScroll()
		m.input.SetValue("")
		m.running = true
		if err := m.rpc.SendPrompt(text); err != nil {
			m.chat.AppendWarning("send failed: " + err.Error())
			m.running = false
		}
		return m, nil
	}

	var cmd tea.Cmd
	m.input, cmd = m.input.Update(msg)
	return m, cmd
}

// handleEvent mutates the ChatModel per the rpc event, then re-arms the pump.
func (m *model) handleEvent(ev Event) (tea.Model, tea.Cmd) {
	switch ev.Kind {
	case EvAssistantTextDelta:
		m.chat.Streaming += ev.Text

	case EvThinkingDelta:
		m.chat.Thinking += ev.Text

	case EvMessageEnd:
		// Commit the streamed/assistant text into a role="assistant" message.
		text := ev.Text
		if text == "" {
			text = m.chat.Streaming
		}
		if strings.TrimSpace(text) != "" {
			m.chat.Messages = append(m.chat.Messages, message{role: "assistant", content: text})
		}
		m.chat.Streaming = ""
		m.chat.Thinking = ""
		m.status.ActiveTool = ""

	case EvToolStart:
		m.chat.Messages = append(m.chat.Messages, message{
			role:   "tool",
			tool:   ev.ToolName,
			toolIn: ev.ToolArgs,
		})
		m.status.ActiveTool = ev.ToolName

	case EvToolEnd:
		m.fillToolResult(ev)
		m.status.ActiveTool = ""

	case EvAgentEnd, EvSettled:
		// Turn finished: stop the spinner and flush any trailing stream text.
		if strings.TrimSpace(m.chat.Streaming) != "" {
			m.chat.Messages = append(m.chat.Messages, message{role: "assistant", content: m.chat.Streaming})
		}
		m.chat.Streaming = ""
		m.chat.Thinking = ""
		m.running = false
		m.status.ActiveTool = ""

	case EvError:
		m.chat.AppendWarning(ev.Text)
		m.running = false

	case EvKernelExit:
		m.chat.AppendWarning("kernel exited")
		m.running = false
		// Do not re-arm the pump; the channel is closed.
		return m, nil

	case EvSession, EvResponse, EvOther:
		// Acknowledged; nothing to render.
	}

	return m, m.waitForEvent()
}

// fillToolResult finds the most recent unfilled tool message matching the
// result's tool name and writes its content (marking warnings on error).
func (m *model) fillToolResult(ev Event) {
	for i := len(m.chat.Messages) - 1; i >= 0; i-- {
		msg := &m.chat.Messages[i]
		if msg.role != "tool" {
			continue
		}
		if msg.content != "" {
			continue // already filled
		}
		if msg.tool != ev.ToolName && ev.ToolName != "" {
			continue
		}
		content := ev.ToolResult
		if ev.IsError {
			content = "error: " + content
		}
		msg.content = content
		return
	}
}

func (m *model) View() tea.View {
	if m.quitting {
		return tea.NewView("")
	}
	if m.width == 0 {
		return tea.NewView("starting attention-tui...\n")
	}

	mainWidth := m.layout.ChatWidth()
	hr := lipgloss.NewStyle().
		Foreground(lipgloss.Color("#585b70")).
		Render(strings.Repeat("─", max(1, mainWidth)))

	// Chat transcript (welcome screen when empty), clipped to the viewport.
	messages := m.chat.RenderMessages(m.running)
	availableHeight := m.height - 6 // status + 3 rules + input + spacing
	if availableHeight < 1 {
		availableHeight = 1
	}
	lines := strings.Split(messages, "\n")
	start := len(lines) - availableHeight - m.chat.Scroll
	if start < 0 {
		start = 0
	}
	end := start + availableHeight
	if end > len(lines) {
		end = len(lines)
	}
	visible := strings.Join(lines[start:end], "\n")
	for n := strings.Count(visible, "\n") + 1; n < availableHeight; n++ {
		visible += "\n"
	}

	statusBar := m.status.Render(StatusRenderInput{
		ModelName: m.modelName,
		Running:   m.running,
		Messages:  m.chat.Messages,
	})

	var b strings.Builder
	b.WriteString("\n")
	b.WriteString(visible)
	b.WriteString("\n")
	b.WriteString(hr)
	b.WriteString("\n")
	b.WriteString(statusBar)
	b.WriteString("\n")
	b.WriteString(hr)
	b.WriteString("\n")
	cursorY := strings.Count(b.String(), "\n")
	b.WriteString(m.inputView())

	v := tea.NewView(b.String())
	if !m.running {
		if cur := m.input.Cursor(); cur != nil {
			cur.Y += cursorY
			v.Cursor = cur
		}
	}
	v.AltScreen = true
	return v
}

// inputView renders the prompt box, or a waiting indicator while a turn runs.
func (m *model) inputView() string {
	if m.running {
		prefix := lipgloss.NewStyle().Foreground(lipgloss.Color("39")).Bold(true).Render("> ")
		dim := lipgloss.NewStyle().Foreground(lipgloss.Color("240"))
		return prefix + dim.Render("("+spinnerVerb()+")")
	}
	return m.input.View()
}

func main() {
	alongPath := flag.String("along-path", "/tmp/along", "path to the along kernel binary")
	modelName := flag.String("model", "claude-sonnet-4-5", "model id passed to the kernel")
	apiKey := flag.String("api-key", "", "API key forwarded to the kernel (--api-key)")
	flag.Parse()

	if _, err := os.Stat(*alongPath); err != nil {
		fmt.Fprintf(os.Stderr, "along binary not found at %s: %v\n", *alongPath, err)
		os.Exit(1)
	}

	rpc, err := NewRPCClient(*alongPath, *modelName, *apiKey)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to start kernel: %v\n", err)
		os.Exit(1)
	}

	m := newModel(rpc, *modelName)
	p := tea.NewProgram(m, tea.WithContext(context.Background()))
	if _, err := p.Run(); err != nil {
		rpc.Close()
		fmt.Fprintf(os.Stderr, "tui error: %v\n", err)
		os.Exit(1)
	}
	rpc.Close()
}
