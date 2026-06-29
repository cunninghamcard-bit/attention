# Scenario: Plugin Registers View

```text
plugin.onload()
  -> plugin.registerView("example-view", factory)
  -> plugin.addCommand(...open example...)
  -> command callback
  -> workspace.getLeaf("tab").setViewState({ type: "example-view" })
  -> ViewRegistry creates ExampleView
```
