// Package app is the single in-process assembly point for the P0 engine.
package app

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/cunninghamcard-bit/Attention/internal/agentloop"
	"github.com/cunninghamcard-bit/Attention/internal/ai"
	"github.com/cunninghamcard-bit/Attention/internal/backend"
	"github.com/cunninghamcard-bit/Attention/internal/backend/local"
	localenv "github.com/cunninghamcard-bit/Attention/internal/execenv/local"
	"github.com/cunninghamcard-bit/Attention/internal/exporthtml"
	"github.com/cunninghamcard-bit/Attention/internal/extension"
	"github.com/cunninghamcard-bit/Attention/internal/hook"
	"github.com/cunninghamcard-bit/Attention/internal/message"
	"github.com/cunninghamcard-bit/Attention/internal/mode/enginefacade"
	"github.com/cunninghamcard-bit/Attention/internal/pipeline"
	"github.com/cunninghamcard-bit/Attention/internal/provider"
	"github.com/cunninghamcard-bit/Attention/internal/session"
	"github.com/cunninghamcard-bit/Attention/internal/tool"
	"github.com/cunninghamcard-bit/Attention/internal/tool/builtin"
	"github.com/cunninghamcard-bit/Attention/internal/worker"
)

type Composition struct {
	Store            backend.EventStore
	Bus              backend.NotifyBus
	Queue            backend.JobQueue
	Repo             session.JsonlSessionRepoAPI
	Host             *worker.Host
	NewSessionFacade func(sessionID string) *enginefacade.Facade
	Stop             func()
}

type ComposeOptions struct {
	DataDir       string
	SessionsDir   string
	CWD           string
	Model         ai.Model
	ThinkingLevel agentloop.ThinkingLevel
	Provider      *provider.Registry
	// HooksPath points at a declarative shell-hooks file (hooks.json). Empty or
	// missing => no hooks (preserves today's no-hooks behavior).
	HooksPath          string
	FakeStream         agentloop.StreamFunc
	ShellPath          string
	ShellCommandPrefix string
}

func Compose(ctx context.Context, opts ComposeOptions) (*Composition, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	dataDir, err := resolveDataDir(opts.DataDir)
	if err != nil {
		return nil, err
	}
	cwd, err := resolveCWD(opts.CWD)
	if err != nil {
		return nil, err
	}
	if opts.Model.ID == "" {
		return nil, errors.New("app: resolved model is required")
	}
	thinkingLevel := opts.ThinkingLevel
	if thinkingLevel == "" {
		thinkingLevel = agentloop.ThinkingMedium
	}

	store := local.NewEventStore(filepath.Join(dataDir, "events"))
	bus := local.NewNotifyBus()
	queue := local.NewJobQueue(64)
	facadeEnv := localenv.New(cwd, localenv.WithShell(opts.ShellPath))
	facadeToolDefs := builtin.NewCodingTools(facadeEnv, opts.ShellCommandPrefix)
	sessionsDir, err := resolveSessionsDir(dataDir, opts.SessionsDir)
	if err != nil {
		return nil, err
	}
	repo := session.NewJsonlSessionRepo(sessionsDir)
	emit := worker.NewEmitter(store, bus)

	stream := opts.FakeStream
	if stream == nil {
		if opts.Provider == nil {
			return nil, errors.New("app: provider registry is required for production stream")
		}
		stream = productionStream(opts.Provider)
	}

	// 声明式 shell-hooks：从 opts.HooksPath（如 <agentDir>/hooks.json）加载一次。
	// 文件缺失/为空 => shellRunner 为 nil，保留今天的“无 hooks”行为。
	shellRunner, err := hook.LoadShellHooks(opts.HooksPath)
	if err != nil {
		return nil, fmt.Errorf("app: load shell hooks: %w", err)
	}

	workerHost := worker.New(worker.Options{
		Queue: queue,
		Store: store,
		Bus:   bus,
		Factory: func(sessionID string) (backend.Agent, error) {
			sess, ok, err := repo.Get(ctx, sessionID)
			if err != nil {
				return nil, err
			}
			if !ok {
				return nil, fmt.Errorf("app: session %q not found", sessionID)
			}
			env := localenv.New(cwd, localenv.WithShell(opts.ShellPath))
			tools, err := wrapBuiltinTools(env, opts.ShellCommandPrefix, opts.Model)
			if err != nil {
				return nil, err
			}
			var hooks *hook.Registry
			var middleware []pipeline.RunMiddleware
			if shellRunner != nil {
				hooks = hook.NewRegistry()
				shellRunner.Register(hooks, sessionID)
				if !shellRunner.HasHandlers() {
					hooks = nil
				}
				// before_agent_start / context 走 MWContext 才会被分发；
				// tool_call / tool_result 由 pipeline fold 直接消费，无需中间件。
				if hooksNeedRunContextMiddleware(hooks) {
					middleware = append(middleware, pipeline.MWContext(pipeline.ContextConfig{
						Hooks: hooks,
						Tools: promptTools(tools),
					}))
				}
			}
			view := &sessionView{ctx: ctx, session: sess}
			agent := worker.NewNative(worker.NativeOptions{
				SessionID: sessionID,
				Snapshot: func() pipeline.AgentSnapshot {
					return pipeline.AgentSnapshot{
						Model:         opts.Model,
						ThinkingLevel: thinkingLevel,
					}
				},
				Env: pipeline.EnvView{
					ID:           "local",
					CWD:          cwd,
					Capabilities: []string{"filesystem", "shell"},
				},
				Session:    view,
				Emit:       emit,
				Stream:     stream,
				Tools:      tools,
				Middleware: middleware,
				Hooks:      hooks,
				ResolveModel: func(spec string) (ai.Model, error) {
					if opts.Provider == nil {
						return ai.Model{}, errors.New("app: provider registry is required for model resolution")
					}
					return resolveModelSpec(opts.Provider, spec)
				},
				OnModelChange: func(ctx context.Context, m ai.Model) error {
					_, err := sess.AppendModelChange(ctx, m.Provider, m.ID)
					return err
				},
			})
			return agent, nil
		},
	})

	hostCtx, cancelHost := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		if err := workerHost.Run(hostCtx); err != nil {
			fmt.Fprintf(os.Stderr, "app: worker host stopped: %v\n", err)
		}
	}()

	var stopOnce sync.Once
	stop := func() {
		stopOnce.Do(func() {
			cancelHost()
			<-done
		})
	}

	return &Composition{
		Store: store,
		Bus:   bus,
		Queue: queue,
		Repo:  repo,
		Host:  workerHost,
		NewSessionFacade: func(sessionID string) *enginefacade.Facade {
			return enginefacade.New(enginefacade.Options{
				SessionID:          sessionID,
				Repo:               repo,
				CWD:                cwd,
				Model:              opts.Model,
				ThinkingLevel:      string(thinkingLevel),
				Provider:           opts.Provider,
				ShellPath:          opts.ShellPath,
				ShellCommandPrefix: opts.ShellCommandPrefix,
				// Metadata 签名无错误位：取不到时只报 ID（不伪造其余字段）。
				Metadata: func() session.Metadata {
					s, ok, err := repo.Get(ctx, sessionID)
					if err != nil || !ok {
						return session.Metadata{ID: sessionID}
					}
					return s.GetMetadata()
				},
				Store:       store,
				Bus:         bus,
				Queue:       queue,
				ExportTools: exportToolDefinitions(facadeToolDefs),
			})
		},
		Stop: stop,
	}, nil
}

func hooksNeedRunContextMiddleware(registry *hook.Registry) bool {
	if registry == nil {
		return false
	}
	return registry.HasHandlers(hook.EventBeforeAgentStart) ||
		registry.HasHandlers(hook.EventContext)
}

func promptTools(tools []tool.Tool) []pipeline.PromptTool {
	out := make([]pipeline.PromptTool, 0, len(tools))
	for _, t := range tools {
		out = append(out, pipeline.PromptTool{
			Name:              t.Name,
			AvailableToPrompt: true,
		})
	}
	return out
}

func resolveDataDir(dataDir string) (string, error) {
	if dataDir != "" {
		return filepath.Abs(dataDir)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".along"), nil
}

func resolveSessionsDir(dataDir string, sessionsDir string) (string, error) {
	if sessionsDir != "" {
		return filepath.Abs(sessionsDir)
	}
	return filepath.Join(dataDir, "sessions"), nil
}

func resolveCWD(cwd string) (string, error) {
	if cwd != "" {
		return filepath.Abs(cwd)
	}
	return os.Getwd()
}

func productionStream(prov *provider.Registry) agentloop.StreamFunc {
	return func(
		ctx context.Context,
		model ai.Model,
		llmCtx ai.Context,
		opts ai.SimpleStreamOptions,
	) *ai.AssistantMessageEventStream {
		auth, err := prov.ResolveAuth(ctx, model)
		if err != nil {
			return streamError(err)
		}
		if auth.APIKey != "" {
			opts.APIKey = auth.APIKey
		}
		if len(auth.Headers) > 0 {
			headers := maps.Clone(opts.Headers)
			if headers == nil {
				headers = map[string]string{}
			}
			maps.Copy(headers, auth.Headers)
			opts.Headers = headers
		}
		return ai.StreamSimple(ctx, model, llmCtx, opts)
	}
}

func streamError(err error) *ai.AssistantMessageEventStream {
	return ai.NewAssistantMessageEventStream(func(yield func(*ai.StreamEvent, error) bool) {
		yield(nil, err)
	})
}

func wrapBuiltinTools(
	env *localenv.Env,
	shellCommandPrefix string,
	model ai.Model,
) ([]tool.Tool, error) {
	ctxFactory := func(context.Context) extension.ExtensionContext {
		return extension.ExtensionContext{
			Cwd:   env.Cwd(),
			Model: func() ai.Model { return model },
		}
	}
	defs := builtin.NewCodingTools(env, shellCommandPrefix)
	out := make([]tool.Tool, 0, len(defs))
	for _, def := range defs {
		wrapped, err := builtin.Wrap(def, ctxFactory)
		if err != nil {
			return nil, err
		}
		out = append(out, wrapped)
	}
	return out, nil
}

func exportToolDefinitions(defs []extension.ToolDefinition) []exporthtml.ToolDefinition {
	out := make([]exporthtml.ToolDefinition, 0, len(defs))
	for _, def := range defs {
		out = append(out, exporthtml.ToolDefinition{
			Name:        def.Name,
			Description: def.Description,
			Parameters:  def.Parameters,
		})
	}
	return out
}

func resolveModelSpec(prov *provider.Registry, spec string) (ai.Model, error) {
	if spec == "" {
		return ai.Model{}, errors.New("app: model spec is empty")
	}
	if providerName, modelID, ok := strings.Cut(spec, "/"); ok {
		if providerName == "" || modelID == "" {
			return ai.Model{}, fmt.Errorf("app: invalid model spec %q", spec)
		}
		model, found := prov.ResolveByProvider(providerName, modelID)
		if !found {
			return ai.Model{}, fmt.Errorf("app: unknown model %q", spec)
		}
		return model, nil
	}
	model, found := prov.Resolve(spec)
	if !found {
		return ai.Model{}, fmt.Errorf("app: unknown model %q", spec)
	}
	return model, nil
}

type sessionView struct {
	ctx     context.Context
	session *session.Session
}

func (v *sessionView) Messages() []message.AgentMessage {
	ctx, err := v.session.BuildContext(v.ctx)
	if err != nil {
		panic(err)
	}
	return ctx.Messages
}

func (v *sessionView) AppendMessage(m message.AgentMessage) error {
	_, err := v.session.AppendMessage(v.ctx, m)
	return err
}
