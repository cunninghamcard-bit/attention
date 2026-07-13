import type { App } from "../../app/App";
import type { InternalPluginDefinition } from "../../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../../plugin/InternalPluginWrapper";
import { Notice } from "../../ui/Notice";
import { openGitDiff } from "../../views/DiffView";
import { GitChangesView } from "./GitChangesView";
import { GitHistoryView } from "./GitHistoryView";
import { GitLogView } from "./GitLogView";
import { GitNavView, openGitNav } from "./review/GitNavView";
import { GitReviewView, openGitReview } from "./review/GitReviewView";

/**
 * Core plugin wrapping the LOCAL git surface (reference: nkzw-tech/codiff):
 * SCM changes view, center review CodeView, right-docked Tree/History nav,
 * file history and log. Cloud twin is the github plugin.
 */
export function createGitPluginDefinition(): InternalPluginDefinition {
  return {
    id: "git",
    name: "Git",
    description: "Local source control for the vault: changes, commit log, history and review.",
    defaultOn: true,
    init(app: App, plugin: InternalPluginWrapper) {
      plugin.registerViewType(GitChangesView.VIEW_TYPE, (leaf) => new GitChangesView(leaf));
      plugin.registerViewType(GitHistoryView.VIEW_TYPE, (leaf) => new GitHistoryView(leaf));
      plugin.registerViewType(GitLogView.VIEW_TYPE, (leaf) => new GitLogView(leaf));
      plugin.registerViewType(GitReviewView.VIEW_TYPE, (leaf) => new GitReviewView(leaf));
      plugin.registerViewType(GitNavView.VIEW_TYPE, (leaf) => new GitNavView(leaf));
      plugin.registerGlobalCommand({
        id: "git:open-changes",
        name: "Open git changes",
        icon: "lucide-file-diff",
        checkCallback: (checking) => {
          if (!app.git.isAvailable()) return false;
          if (!checking) {
            void app.workspace.getLeaf("tab").setViewState({ type: "git-changes", active: true });
          }
          return true;
        },
      });
      plugin.registerGlobalCommand({
        id: "git:review-changes",
        name: "Review working tree changes",
        icon: "lucide-file-diff",
        checkCallback: (checking) => {
          if (!app.git.isAvailable()) return false;
          if (!checking) void openGitReview(app, { kind: "working-tree" }, "tree");
          return true;
        },
      });
      plugin.registerGlobalCommand({
        id: "git:open-nav",
        name: "Open git navigator",
        icon: "lucide-git-branch",
        checkCallback: (checking) => {
          if (!app.git.isAvailable()) return false;
          if (!checking) void openGitNav(app, true, "tree");
          return true;
        },
      });
      // "git log" in the palette → codiff History on the right, not the old accordion view.
      plugin.registerGlobalCommand({
        id: "git:open-log",
        name: "Open commit history",
        icon: "lucide-history",
        checkCallback: (checking) => {
          if (!app.git.isAvailable()) return false;
          if (!checking) void openGitReview(app, { kind: "working-tree" }, "history");
          return true;
        },
      });
      plugin.registerGlobalCommand({
        id: "git:diff-active-file",
        name: "Open git diff for active file",
        icon: "lucide-file-diff",
        checkCallback: (checking) => {
          const file = app.workspace.getActiveFileView()?.file;
          if (!file || !app.git.isAvailable()) return false;
          if (!checking) {
            void openGitDiff(app, file).then((leaf) => {
              if (!leaf) new Notice("Git is not available for this vault");
            });
          }
          return true;
        },
      });
    },
  };
}
