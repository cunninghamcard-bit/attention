# Architecture Map

This reconstructed project is organized as layered app architecture.

```text
Desktop shell
  desktop/*
  native/*
  shell/*

Renderer app core
  app/*
  workspace/*
  views/*
  ui/*

Knowledge system
  vault/*
  metadata/*    (scoped; no full Obsidian wiki-link resolver or TagIndex parity)
  properties/*
  query/*
  bases/*

Default product surface
  views/MarkdownView.ts
  markdown/*
  editor/*

Plugin ecosystem
  plugin/*
  theme-market/*
  examples/plugins/*

Operations and service facades
  storage/*
  recovery/*
  revisions/*
  diagnostics/*
  sync/*        (facade only; not product parity)
  publish/*     (facade only; not product parity)

Distribution
  build/*
  packaging/*
  release/*
```

The most important idea is that built-in product features and community plugins use the same registration surfaces where possible.

Explicit non-goals are recorded in `docs/scope-boundary.md`. Built-in feature names may remain as thin seams or fixtures, but Graph, Backlinks, Outgoing Links, Canvas, Daily Notes, Templates, Publish, Sync, Slides, Audio Recorder, Bookmarks, the full Wiki Link Resolver, and full TagIndex are not implementation targets.
