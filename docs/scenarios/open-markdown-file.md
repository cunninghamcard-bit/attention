# Scenario: Open Markdown File

```text
workspace.getLeaf()
  -> leaf.openFile(file)
  -> viewRegistry.getViewTypeByExtension("md")
  -> leaf.setViewState({ type: "markdown" })
  -> MarkdownView.onOpen()
  -> EditorViewHost or MarkdownPreviewRenderer
```
