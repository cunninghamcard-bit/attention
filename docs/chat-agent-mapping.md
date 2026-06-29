# Mapping Obsidian Architecture to a Chat Agent App

Obsidian's default product is MarkdownView.
A chat-agent app's default product should be ChatView.

```text
Obsidian
  WorkspaceLeaf -> MarkdownView -> MarkdownRenderer / Editor

Chat Agent App
  WorkspaceLeaf -> ChatView -> MessageList / Composer / EventReducer
```

Recommended ChatView extension points:

```text
ctx.chat.registerMessageRenderer(type, renderer)
ctx.chat.registerToolRenderer(toolName, renderer)
ctx.chat.registerComposerAction(action)
ctx.chat.registerSlashCommand(command)
ctx.chat.registerMessageAction(action)
ctx.events.on("agent.*", handler)
ctx.workspace.registerView(type, factory)
ctx.themes.registerTheme(theme)
```

Equivalent mapping:

```text
MarkdownPostProcessor -> MessagePostProcessor
CodeBlockProcessor -> ToolResultRenderer / CodeBlockRenderer
EditorExtension -> ComposerExtension
MetadataCache -> ConversationIndex / RunIndex
WorkspaceLeaf -> Chat/Terminal/Timeline/File views
Vault -> Project files + conversation store
```

The key lesson:

```text
Do not make ChatView the whole app.
Make ChatView the default strong View inside Workspace.
Then expose controlled extension points around messages, tools, composer and events.
```
