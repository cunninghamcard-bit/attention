import type { App } from "../../app/App";
import type { InternalPluginDefinition } from "../../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../../plugin/InternalPluginWrapper";
import { GitCommitView, GitHubWorkspaceView, openGitHubWorkspace } from "./GitHubWorkspace";
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

/** Core plugin wrapping the Oh-My-GitHub-style cloud workspace surface. */
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
