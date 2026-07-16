import type { App } from "../../app/App";
import type { InternalPluginDefinition } from "../../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../../plugin/InternalPluginWrapper";
import { GitCommitView } from "./GitCommitView";
import { GitHubDetailView } from "./GitHubDetailView";
import { GitHubListView } from "./GitHubListView";
import { GitHubNavView } from "./GitHubNavView";
import { GitHubRepoView } from "./GitHubRepoView";
import { PrDetailView } from "./GitPrViews";
import { GitHubSearchModal } from "./GitHubSearchModal";
import { openGitHubNav, openInbox, openQueryList, refreshGitHub } from "./open";

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
      plugin.registerViewType(GitHubNavView.VIEW_TYPE, (leaf) => new GitHubNavView(leaf));
      plugin.registerViewType(GitHubListView.VIEW_TYPE, (leaf) => new GitHubListView(leaf));
      plugin.registerViewType(GitHubRepoView.VIEW_TYPE, (leaf) => new GitHubRepoView(leaf));
      plugin.registerViewType(PrDetailView.VIEW_TYPE, (leaf) => new PrDetailView(leaf));
      plugin.registerViewType(GitCommitView.VIEW_TYPE, (leaf) => new GitCommitView(leaf));
      plugin.registerViewType(GitHubDetailView.VIEW_TYPE, (leaf) => new GitHubDetailView(leaf));

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
        callback: () => new GitHubSearchModal(app).open(),
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
