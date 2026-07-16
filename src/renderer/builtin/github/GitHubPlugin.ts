import type { App } from "../../app/App";
import type { InternalPluginDefinition } from "../../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../../plugin/InternalPluginWrapper";
import { GitCommitView } from "./GitCommitView";
import { GitHubDetailView } from "./GitHubDetailView";
import { GitHubListView } from "./GitHubListView";
import { GitHubNavView } from "./GitHubNavView";
import { GitHubProfileView } from "./GitHubProfileView";
import { GitHubRepoView } from "./GitHubRepoView";
import { PrDetailView } from "./GitPrViews";
import type { Scope } from "../../app/hotkeys/Scope";
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
      // ⌘F belongs to the view, not to a global command. `Workspace` pushes the
      // active leaf's own scope (View.scope) above the root one the hotkey
      // manager registers on, so a GitHub leaf answers ⌘F first and a note
      // still gets the editor's search. A second *global* ⌘F command would not
      // work: the dispatcher stops at the first match and drops
      // checkCallback's verdict, so whichever bakes first silently wins.
      const withSearchBar = <T extends { scope: Scope | null; contentEl: HTMLElement }>(
        view: T,
      ): T => {
        view.scope?.register(["Mod"], "F", (event) => {
          event.preventDefault();
          GitHubSearchBar.toggle(app, view);
          return false;
        });
        return view;
      };

      plugin.registerViewType(GitHubNavView.VIEW_TYPE, (leaf) => new GitHubNavView(leaf));
      plugin.registerViewType(GitHubListView.VIEW_TYPE, (leaf) =>
        withSearchBar(new GitHubListView(leaf)),
      );
      plugin.registerViewType(GitHubRepoView.VIEW_TYPE, (leaf) =>
        withSearchBar(new GitHubRepoView(leaf)),
      );
      // The profile is a GitHub center leaf like the rest — ⌘F answers here too.
      plugin.registerViewType(GitHubProfileView.VIEW_TYPE, (leaf) =>
        withSearchBar(new GitHubProfileView(leaf)),
      );
      plugin.registerViewType(PrDetailView.VIEW_TYPE, (leaf) =>
        withSearchBar(new PrDetailView(leaf)),
      );
      plugin.registerViewType(GitCommitView.VIEW_TYPE, (leaf) =>
        withSearchBar(new GitCommitView(leaf)),
      );
      plugin.registerViewType(GitHubDetailView.VIEW_TYPE, (leaf) =>
        withSearchBar(new GitHubDetailView(leaf)),
      );

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
          const view = activeGitHubView(app);
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

/** The bar mounts on a center view; the dock nav is not one of them. */
const SEARCHABLE_VIEWS: ReadonlySet<string> = new Set([
  GITHUB_VIEW.list,
  GITHUB_VIEW.repo,
  GITHUB_VIEW.prDetail,
  GITHUB_VIEW.commit,
  GITHUB_VIEW.detail,
]);

/** The GitHub center view in front of the user, if there is one. */
function activeGitHubView(app: App): { contentEl: HTMLElement } | null {
  const view = app.workspace.activeLeaf?.view;
  if (!view || !SEARCHABLE_VIEWS.has(view.getViewType())) return null;
  return view as unknown as { contentEl: HTMLElement };
}
