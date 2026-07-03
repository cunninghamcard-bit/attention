export interface ProjectStatusSection {
  name: string;
  status: "complete-skeleton" | "study-ready" | "placeholder-boundary";
  paths: string[];
  note: string;
}

export interface ProjectStatus {
  project: string;
  purpose: string;
  sourceFidelity: string;
  sections: ProjectStatusSection[];
}

export const projectStatus: ProjectStatus = {
  project: "Obsidian Reconstructed",
  purpose: "Readable architectural skeleton for studying Obsidian-style frontend, workspace, markdown, plugin, theme and desktop-shell design.",
  sourceFidelity: "Clean-room reconstruction from bundled/public architecture signals; not original Obsidian source.",
  sections: [
    {
      name: "Core app and workspace",
      status: "complete-skeleton",
      paths: ["src/app", "src/workspace", "src/views", "src/builtin"],
      note: "App composition, workspace tree, View lifecycle and default platform views are modeled; non-goal built-ins remain thin seams only.",
    },
    {
      name: "Markdown product surface",
      status: "complete-skeleton",
      paths: ["src/views/MarkdownView.ts", "src/markdown", "src/editor"],
      note: "Markdown rendering, processors and editor-extension shape are modeled.",
    },
    {
      name: "Plugin and theme ecosystem",
      status: "complete-skeleton",
      paths: ["src/plugin", "src/theme", "src/theme-market", "examples/plugins"],
      note: "Lifecycle, registration, cleanup, marketplace/install and examples are modeled.",
    },
    {
      name: "Knowledge and structured data",
      status: "complete-skeleton",
      paths: ["src/vault", "src/metadata", "src/properties", "src/query"],
      note: "Vault, scoped metadata links/tags/search, frontmatter properties and the query engine are modeled; Bases views were removed in the agent-workspace refit.",
    },
    {
      name: "Desktop/product outer shell",
      status: "study-ready",
      paths: ["electron", "src/desktop", "src/native", "src/shell"],
      note: "The Electron main process (electron/) is a real implementation — window lifecycle, app:// protocol, IPC, obsidian:// routing, hardening and native menus. The renderer-side desktop bridge remains a product-boundary facade; Sync/Publish/Account were removed in the agent-workspace refit.",
    },
    {
      name: "Navigation and learning docs",
      status: "complete-skeleton",
      paths: ["docs", "src/meta", "fixtures"],
      note: "Reading order, module index, completeness matrix, extension points and Chat Agent mapping are provided.",
    },
  ],
};
