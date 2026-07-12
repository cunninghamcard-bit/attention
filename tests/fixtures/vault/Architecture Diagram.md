# Architecture Diagram

```mermaid
graph TD
  App --> Workspace
  Workspace --> View
  View --> MarkdownView
  Plugin --> ViewRegistry
```
