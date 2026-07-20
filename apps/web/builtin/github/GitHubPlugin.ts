import type { App } from "../../app/App";
import type { InternalPluginDefinition } from "../../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../../plugin/InternalPluginWrapper";
import type { View } from "../../views/View";
import type { WorkspaceLeaf } from "../../views/workspace/WorkspaceLeaf";
import { GitCommitView } from "./GitCommitView";
import { GitHubDetailView } from "./GitHubDetailView";
import { GitHubListView } from "./GitHubListView";
import { GitHubNavView } from "./GitHubNavView";
import { GitHubProfileView } from "./GitHubProfileView";
import { GitHubRepoView } from "./GitHubRepoView";
import { PrDetailView } from "./GitPrViews";
import { GitHubSearchBar } from "./GitHubSearchBar";
import { GITHUB_VIEW, openGitHubNav, openInbox, openQueryList, refreshGitHub } from "./open";

/**
 * Core plugin wrapping the CLOUD surface, modeled on Oh My GitHub: a persistent
 * left-dock query navigator (Inbox / Pull Requests / Issues / Repositories)
 * drives center tabs — cross-repo query lists and single-repo tabs — with
 * PR / commit / issue detail as their own tabs. Offline twin is the git plugin.
 */
export function createGitHubPluginDefinition(): InternalPluginDefinition {
  return {
    id: "github",
    name: "GitHub",
    description: "Cloud workspace for GitHub: pull requests, issues, repositories, notifications.",
    defaultOn: true,
    init(app: App, plugin: InternalPluginWrapper) {
      /** Types registered as searchable. Filled by `registerSearchableView`, so
       * it cannot disagree with what ⌘F is actually wired to. */
      const searchableTypes = new Set<string>();

      /** Registers a GitHub center view: ⌘F opens the search bar on it, and the
       * `github:search` command can find it. Both halves come from this one
       * call — declaring them separately is how the profile leaf ended up
       * answering ⌘F while the command silently navigated away instead.
       *
       * ⌘F belongs to the view, not to a global command. `Workspace` pushes the
       * active leaf's own scope (View.scope) above the root one the hotkey
       * manager registers on, so a GitHub leaf answers ⌘F first and a note
       * still gets the editor's search. A second *global* ⌘F command would not
       * work: the dispatcher stops at the first match and drops
       * checkCallback's verdict, so whichever bakes first silently wins. */
      const registerSearchableView = <T extends View & { contentEl: HTMLElement }>(
        type: string,
        create: (leaf: WorkspaceLeaf) => T,
      ): void => {
        searchableTypes.add(type);
        plugin.registerViewType(type, (leaf) => {
          const view = create(leaf);
          view.scope?.register(["Mod"], "F", (event) => {
            event.preventDefault();
            GitHubSearchBar.toggle(app, view);
            return false;
          });
          return view;
        });
      };

      // The dock nav is not a center view: nothing to search on it.
      plugin.registerViewType(GitHubNavView.VIEW_TYPE, (leaf) => new GitHubNavView(leaf));
      registerSearchableView(GitHubListView.VIEW_TYPE, (leaf) => new GitHubListView(leaf));
      registerSearchableView(GitHubRepoView.VIEW_TYPE, (leaf) => new GitHubRepoView(leaf));
      registerSearchableView(GitHubProfileView.VIEW_TYPE, (leaf) => new GitHubProfileView(leaf));
      registerSearchableView(PrDetailView.VIEW_TYPE, (leaf) => new PrDetailView(leaf));
      registerSearchableView(GitCommitView.VIEW_TYPE, (leaf) => new GitCommitView(leaf));
      registerSearchableView(GitHubDetailView.VIEW_TYPE, (leaf) => new GitHubDetailView(leaf));

      plugin.registerGlobalCommand({
        id: "github:open-workspace",
        name: "Open GitHub",
        icon: "lucide-github",
        callback: () => void openGitHubNav(app),
      });
      plugin.registerGlobalCommand({
        id: "github:search",
        name: "Search GitHub workspace",
        icon: "lucide-search",
        // Same bar ⌘F summons, on the GitHub leaf in front of the user. With no
        // GitHub leaf there is nothing to mount on, so open the workspace first.
        callback: () => {
          const view = activeGitHubView(app, searchableTypes);
          if (view) GitHubSearchBar.toggle(app, view);
          else void openGitHubNav(app);
        },
      });
      plugin.registerGlobalCommand({
        id: "github:refresh",
        name: "Refresh GitHub view",
        icon: "lucide-rotate-ccw",
        callback: () => refreshGitHub(app),
      });
      plugin.registerGlobalCommand({
        id: "github:open-pull-requests",
        name: "Open pull requests I need to review",
        icon: "lucide-git-pull-request",
        callback: () => void openQueryList(app, "pr", "review-requested"),
      });
      plugin.registerGlobalCommand({
        id: "github:my-pull-requests",
        name: "Open my pull requests",
        icon: "lucide-git-pull-request",
        callback: () => void openQueryList(app, "pr", "created"),
      });
      plugin.registerGlobalCommand({
        id: "github:my-issues",
        name: "Open my issues",
        icon: "lucide-circle-dot",
        callback: () => void openQueryList(app, "issue", "created"),
      });
      plugin.registerGlobalCommand({
        id: "github:inbox",
        name: "Open GitHub inbox",
        icon: "lucide-inbox",
        callback: () => void openInbox(app),
      });
    },
  };
}

/** The GitHub center view in front of the user, if there is one. `searchable`
 * comes from the registrations themselves, so a view can never be wired to ⌘F
 * yet be invisible to the command. */
function activeGitHubView(
  app: App,
  searchable: ReadonlySet<string>,
): { contentEl: HTMLElement } | null {
  const view = app.workspace.activeLeaf?.view;
  if (!view || !searchable.has(view.getViewType())) return null;
  return view as unknown as { contentEl: HTMLElement };
}
