import type { App } from "../app/App";

export interface WorkspacePublicApi {
  getLeaf: App["workspace"]["getLeaf"];
  getLeavesOfType: App["workspace"]["getLeavesOfType"];
  getActiveViewOfType: App["workspace"]["getActiveViewOfType"];
  onLayoutReady: App["workspace"]["onLayoutReady"];
}

export interface VaultPublicApi {
  vault: App["vault"];
  fileManager: App["fileManager"];
  metadataCache: App["metadataCache"];
  linkGraph: App["linkGraph"];
  tagIndex: App["tagIndex"];
  search: App["search"];
}

export interface AppearancePublicApi {
  themes: App["themes"];
  customCss: App["customCss"];
  cssSnippets: App["cssSnippets"];
  appearance: App["appearance"];
}

export interface BasesPublicApi {
  query: App["query"];
  metadataTypeManager: App["metadataTypeManager"];
  properties: App["properties"];
}

export interface ShellPublicApi {
  shell: App["shell"];
  uriRouter: App["uriRouter"];
  fileDialogs: App["shell"]["fileDialogs"];
}

export interface ObsidianPublicApi {
  app: App;
  workspace: WorkspacePublicApi;
  vault: VaultPublicApi;
  appearance: AppearancePublicApi;
  bases: BasesPublicApi;
  shell: ShellPublicApi;
}

export function createPublicApi(app: App): ObsidianPublicApi {
  return {
    app,
    workspace: {
      getLeaf: app.workspace.getLeaf.bind(app.workspace),
      getLeavesOfType: app.workspace.getLeavesOfType.bind(app.workspace),
      getActiveViewOfType: app.workspace.getActiveViewOfType.bind(app.workspace),
      onLayoutReady: app.workspace.onLayoutReady.bind(app.workspace),
    },
    vault: {
      vault: app.vault,
      fileManager: app.fileManager,
      metadataCache: app.metadataCache,
      linkGraph: app.linkGraph,
      tagIndex: app.tagIndex,
      search: app.search,
    },
    appearance: {
      themes: app.themes,
      customCss: app.customCss,
      cssSnippets: app.cssSnippets,
      appearance: app.appearance,
    },
    bases: {
      query: app.query,
      metadataTypeManager: app.metadataTypeManager,
      properties: app.properties,
    },
    shell: {
      shell: app.shell,
      uriRouter: app.uriRouter,
      fileDialogs: app.shell.fileDialogs,
    },
  };
}
