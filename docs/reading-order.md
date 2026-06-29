# Reading Order

Use this order if you are new to frontend architecture.

```text
1. src/dom + src/ui
2. src/app/App.ts
3. src/workspace/Workspace.ts
4. src/workspace/WorkspaceSplit.ts
5. src/workspace/WorkspaceTabs.ts
6. src/workspace/WorkspaceLeaf.ts
7. src/views/View.ts
8. src/views/ItemView.ts
9. src/views/MarkdownView.ts
10. src/markdown/MarkdownRenderer.ts
11. src/plugin/Plugin.ts
12. src/plugin/PluginManager.ts
13. examples/plugins/custom-view-plugin/main.ts
14. examples/plugins/markdown-processor-plugin/main.ts
15. src/properties + src/query + src/bases
```

The mental model:

```text
App composes services.
Workspace manages layout.
Leaf hosts View.
MarkdownView is the default product surface.
Plugin registers extension points.
CSS makes the object tree visible.
```
