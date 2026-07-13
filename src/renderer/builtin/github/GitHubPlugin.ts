import type { App } from "../../app/App";
import type { InternalPluginDefinition } from "../../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../../plugin/InternalPluginWrapper";
import { GitCommitView, GitHubWorkspaceView, openGitHubWorkspace } from "./GitHubWorkspace";
import { openPrList, PrDetailView, PrListView } from "./GitPrViews";
import type { GithubWorkspaceSection } from "./types";

const SECTION_COMMANDS: Array<{ section: GithubWorkspaceSection; name: string; icon: string }> = [
  { section: "pulls", name: "Open GitHub workspace", icon: "lucide-github" },
  { section: "commits", name: "Open GitHub commits", icon: "lucide-git-commit" },
  { section: "branches", name: "Open GitHub branches", icon: "lucide-git-branch" },
  { section: "issues", name: "Open GitHub issues", icon: "lucide-circle-dot" },
  { section: "actions", name: "Open GitHub actions", icon: "lucide-play" },
  { section: "files", name: "Open GitHub files", icon: "lucide-folder" },
  { section: "inbox", name: "Open GitHub inbox", icon: "lucide-inbox" },
];

/**
 * Core plugin wrapping the CLOUD surface (reference: jiacai2050/oh-my-github):
 * the workspace sections plus the pull-request list/detail views. Everything
 * here talks to the GitHub API; the offline twin is the git plugin.
 */
export function createGitHubPluginDefinition(): InternalPluginDefinition {
  return {
    id: "github",
    name: "GitHub",
    description: "Cloud workspace for a repository: PRs, commits, branches, issues, actions.",
    defaultOn: true,
    init(app: App, plugin: InternalPluginWrapper) {
      plugin.registerViewType(
        GitHubWorkspaceView.VIEW_TYPE,
        (leaf) => new GitHubWorkspaceView(leaf),
      );
      plugin.registerViewType(GitCommitView.VIEW_TYPE, (leaf) => new GitCommitView(leaf));
      plugin.registerViewType(PrListView.VIEW_TYPE, (leaf) => new PrListView(leaf));
      plugin.registerViewType(PrDetailView.VIEW_TYPE, (leaf) => new PrDetailView(leaf));
      plugin.registerGlobalCommand({
        id: "github:open-pull-requests",
        name: "Open pull requests",
        icon: "lucide-git-pull-request",
        callback: () => {
          void openPrList(app);
        },
      });
      for (const { section, name, icon } of SECTION_COMMANDS) {
        plugin.registerGlobalCommand({
          id: `github:open-${section === "pulls" ? "workspace" : section}`,
          name,
          icon,
          callback: () => {
            void openGitHubWorkspace(app, { section });
          },
        });
      }
    },
  };
}
