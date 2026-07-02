# ChatView Design

ChatView is the default strong View of a chat-agent app, the way MarkdownView is
the default strong View of Obsidian. It lives inside Workspace, not above it.

This document merges three earlier sources into one decided design:

- `docs/chat-agent-mapping.md` (extension-point mapping)
- `along/docs/chat-view-architecture-discussion.md` (streaming, communication, state layer)
- the markstream spike (parser adoption, NodeRenderer contract)

## Position in the app

```text
App
  Workspace
    WorkspaceLeaf
      ChatView            <- ItemView subclass, like GraphView / SearchView
```

- ChatView extends ItemView, NOT FileView. A conversation is a DB row, not a file.
- View state is `{ threadId }` via getState/setState — participates in layout persistence.
- Draft text and scroll position are ephemeral state, per leaf.
- Multiple leaves may open the same thread; they share one ChatSession.

## Builtin wiring

Chat is builtin, NOT a core plugin. The tier matters: core plugins are
optional features a user can toggle off (outline, tag pane); the default
strong view is the product itself, the tier MarkdownView lives at. You can
disable the outline; you cannot disable "viewing markdown" — and in a
chat-agent app you cannot disable chat.

Wiring (`src/chat/ChatBuiltin.ts`):

```text
registerChatViewType(app)     from registerBuiltinViews, next to
                              developer-console (the builtin-view seam)
registerChatBuiltin(app)      from the App constructor after
                              registerAppCommands:
  chat:open / chat:new-thread / chat:stop   commands (+ Mod+Shift+C)
  ribbon icon                                left bar entry point
  /new and /stop slash commands              run-style ChatSlashCommand
ChatSettingTab                added in App.registerSettings with the other
                              builtin setting tabs
```

View-surface alignment with other views:

- navigation = true; back/forward buttons work like file views
- tab + header title derives from the first user message (the way file views
  derive theirs from the file); refreshes via updateHeader()
- header actions: new thread, stop (visible only while running)
- onPaneMenu contributes "New thread" and "Copy conversation"
- per-message copy action; transcript export via chatTranscriptToMarkdown
- empty state and a thinking indicator while waiting between parts

## Layers

```text
Engine backend (Claude Code bridge now, along-go later)
  | REST commands / SSE canonical events
ChatTransport            internal, invisible to plugins
  |
ChatSession              state layer, extends Events, single source of truth
  |  Message = Part[]    reduce(state, event) folds canonical events
ChatView
  |- ChatMessageList     one ChatMessageItem per message
  |    `- ChatMessageItem  per-part dispatch -> renderers; goes quiescent
  |                        the moment its message closes (live turn = the
  |                        open tail item; DOM hands itself off in place)
  |- ChatComposer        textarea + composer actions + slash commands
  `- ChatScroller        stick-to-bottom state machine
```

Rules carried over from the along discussion:

- The state layer is the frontend's single source of truth. Plugins never talk
  to the transport; they call ChatSession methods and subscribe to its events.
- Live SSE and history replay go through the same reducer. History is "events
  already reduced"; reconnect is snapshot + resume by `seq`. One render path.

## Message model

```text
ChatMessage { id, role: "user" | "assistant", parts: ChatPart[], status }
ChatPart =
  | TextPart       { type: "text", markdown, closed }
  | ThinkingPart   { type: "thinking", markdown, closed }
  | ToolPart       { type: "tool", toolName, input, result?, status }
```

Tool calls are structured data end to end. They are never encoded into
markdown and re-parsed back out. The agent event stream is already structured;
we keep it structured all the way to the renderer.

## Canonical events

Defined in `src/chat/ChatEvent.ts` (TS side is authoritative while the bridge
is ours; ownership moves to the Go facade when along-go becomes the producer).
Every event carries `threadId` and a monotonically increasing `seq`.

```text
run.started      { runId }
part.opened      { messageId, partIndex, partType, toolName? }
part.delta       { messageId, partIndex, delta }
part.closed      { messageId, partIndex, result? }
message.started  { messageId, role }
message.closed   { messageId }
run.closed       { runId, status: "completed" | "error" | "aborted", error? }
```

This is the fn1/fn2 split from pi: the bridge (fn1) turns raw engine events
into canonical events; the reducer (fn2) turns canonical events into state.

## Streaming render pipeline

Adopted libraries (pinned):

- `stream-markdown-parser` — markdown-it core + mid-state handling. Feed the
  growing TextPart buffer, get `ParsedNode[]`; growing node carries
  `loading: true`; `parse({ final: true })` on part.closed.

Typewriter pacing is deferred: this markstream-core version does not export
its smooth-stream controller, so v1 coalesces deltas into one parse + DOM
pass per animation frame (ChatView.scheduleSync). Revisit if bursty engines
look choppy.

Spike-verified NodeRenderer contract (`src/chat/StreamMarkdownRenderer.ts`):

```text
input:      ParsedNode[] (full array each round)
state:      previous [raw, HTMLElement] pairs
diff:       nodes are content-stable, not reference-stable; compare by
            position + node.raw. Change only ever appears at the tail.
lifecycle:  one MarkdownRenderChild per block node; re-render = unload + load
loading:    render partial content + `is-loading` class
DOM:        recursive createEl from the typed node tree; no HTML strings,
            XSS boundary stays closed
post:       MarkdownPostProcessor chain runs after each node render
```

Three levels of tail-only updates keep everything cheap:
message list -> live turn -> tail node. No virtualization (arkloop proves
slice + memo is enough); revisit only if profiling says otherwise.

DOM handoff: a completed message keeps the exact DOM it streamed into — the
item simply stops updating (its part signatures stop changing), so there is
no re-render and no flicker. This is a vanilla-only advantage; React cannot
keep a subtree while dropping its render path.

## Extension points

Plugins reach chat exclusively through `app.chat` (ChatManager) — an
app-level service beside metadataCache and customCss. Nothing chat-related
is exported from the obsidian module; that surface stays parity-pure.

```text
app.chat.getSession(threadId)                      the shared per-thread session
app.chat.listSessions()
app.chat.registerToolRenderer(toolName, renderer)  structured tool blocks
app.chat.registerSlashCommand(command)
app.chat.registerComposerAction(action)
app.chat.registerMessageAction(action)
app.chat.registerComposerExtension(cmExtension)    the editor seam
registerMarkdownPostProcessor(...)                 existing chain, reused
markdown-it plugins via parser config              syntax extensions
```

- The parser is an internal implementation detail. Plugin contracts expose
  node types and registries, never markdown-it or markstream types, so the
  engine can be swapped without breaking plugins.
- The host owns lifecycle, cleanup, layout, persistence and safety; plugins
  register capabilities (same rule as docs/extension-points.md).

## Element contract

ChatView does not invent an element dialect: rendered chat DOM speaks
MarkdownView's element vocabulary, so theme CSS, the post-processor chain,
hover preview and the shared link handlers all apply unchanged.

```text
span.internal-link[data-href][data-sourcePath]   [[wikilinks]] in messages;
                                                 click/hover/context-menu via
                                                 the same delegated handlers,
                                                 installed per chat root with
                                                 sourcePath chat://<threadId>
a.external-link                                  http(s) links
code.language-x inside pre                       code fences — language
                                                 processors (mermaid, math,
                                                 query, base) fire in chat
                                                 exactly as in reading view
button.copy-code-button                          added by a default
                                                 post-processor; both views
                                                 get it, app.css already
                                                 ships the styles
```

Chat-specific anatomy is a stable selector contract for plugins and themes:

```text
.chat-message[data-role][data-message-id]
  .chat-message-header > .chat-message-role + .chat-message-actions
  .chat-message-parts > .chat-part[data-part-type][data-tool-name]
```

Element-level registries: registerChatMessageAction (per-message hover
actions; "Copy" is the builtin first entry), plus the existing tool renderer,
composer action and slash registries. Host differences stay in context, not
in forked renderers: chat sourcePath is chat://…, so a post-processor can
tell which host it is running in; interactive markdown that writes back to
files (task checkboxes) stays read-only in chat.

## Communication

REST for commands, SSE for pushes (WebSocket rejected; see along discussion).

Dev backend: `server/chat-bridge.ts` (bun). Drives
`claude -p --output-format stream-json --include-partial-messages`,
maps threadId -> Claude Code session id, transforms stream-json into
canonical events. It stands in for along-go and speaks the same contract.

## Composer

The composer is a CodeMirror 6 extension host, the composer counterpart of
MarkdownView's editor:

```text
registerChatComposerExtension(ext)   CM Extension pass-through (mirrors
                                     registerEditorExtension); a Compartment
                                     reconfigures live composers on change
slash commands                       @codemirror/autocomplete source at the
                                     draft start; run-style commands execute,
                                     insert-style commands replace the draft
[[wikilink]] completion              vault-fed source (basenames via the
                                     view); accepts to [[target]]
Enter                                accepts an open completion first,
                                     submits otherwise; Shift+Enter newline
```

The textarea-first plan was executed and then upgraded exactly as designed:
the registry contracts did not change when the editor core did.

## Decided along the way

- Composer started as a plain textarea plus the action/slash registries; the
  registry contract was the API, which let the editor core upgrade to
  CodeMirror without breaking callers.
- No document-level "streaming parser" is needed beyond markstream: block
  cache at the message level already bounds work to the tail (the 100x claims
  of streaming parsers measure against full re-parse baselines we never had).
- ScrollController is its own component: stick to bottom while streaming,
  detach when the user scrolls up, show a return button on new content.
