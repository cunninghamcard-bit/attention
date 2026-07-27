/**
 * Input: ../../app/App, ../../plugin/InternalPlugin, ../../plugin/InternalPluginWrapper, ./GitHistoryView, ./GitLogView, ./review/GitNavView, ./review/GitReviewView
 * Output: createGitPluginDefinition
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import type { App } from "../../app/App";
import type { InternalPluginDefinition } from "../../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../../plugin/InternalPluginWrapper";
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
      plugin.registerViewType(GitHistoryView.VIEW_TYPE, (leaf) => new GitHistoryView(leaf));
      plugin.registerViewType(GitLogView.VIEW_TYPE, (leaf) => new GitLogView(leaf));
      plugin.registerViewType(GitReviewView.VIEW_TYPE, (leaf) => new GitReviewView(leaf));
      plugin.registerViewType(GitNavView.VIEW_TYPE, (leaf) => new GitNavView(leaf));
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
    },
  };
}
