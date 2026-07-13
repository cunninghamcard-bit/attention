import type { App } from "../../app/App";
import { SuggestModal } from "../../ui/suggest/SuggestModal";
import { Notice } from "../../ui/Notice";
import type { GitBranch } from "./GitService";

/** One row in the switcher: an existing branch, or the create-new offer. */
export interface BranchEntry {
  type: "branch" | "create";
  name: string;
  current?: boolean;
}

/** Names git itself would reject get no create offer. */
export function isPlausibleBranchName(name: string): boolean {
  return (
    name.length > 0 &&
    !/[\s~^:?*[\\]/.test(name) &&
    !name.startsWith("-") &&
    !name.startsWith(".") &&
    !name.endsWith("/") &&
    !name.endsWith(".lock") &&
    !name.includes("..") &&
    !name.includes("//") &&
    !name.includes("@{")
  );
}

/**
 * Pure entry builder: matching branches first (current one always shown),
 * then a create offer when the query names no existing branch.
 */
export function buildBranchEntries(branches: GitBranch[], query: string): BranchEntry[] {
  const trimmed = query.trim();
  const needle = trimmed.toLowerCase();
  const matches = branches.filter((b) => !needle || b.name.toLowerCase().includes(needle));
  const entries: BranchEntry[] = matches.map((b) => ({
    type: "branch",
    name: b.name,
    current: b.current,
  }));
  const exists = branches.some((b) => b.name === trimmed);
  if (trimmed && !exists && isPlausibleBranchName(trimmed))
    entries.push({ type: "create", name: trimmed });
  return entries;
}

/** Branch switcher: local branches + create-new, QuickSwitcher pattern. */
export class BranchSwitchModal extends SuggestModal<BranchEntry> {
  private branches: GitBranch[] = [];

  constructor(app: App) {
    super(app);
    this.setPlaceholder("Switch branch or type a new name...");
    this.emptyStateText = "No branches";
    this.setInstructions([
      { command: "↑↓", purpose: "Navigate" },
      { command: "↵", purpose: "Switch / create" },
      { command: "esc", purpose: "Dismiss" },
    ]);
  }

  override onOpen(): void {
    super.onOpen();
    void this.app.git.branches().then((branches) => {
      this.branches = branches;
      this.updateSuggestions();
    });
  }

  getSuggestions(query: string): BranchEntry[] {
    return buildBranchEntries(this.branches, query);
  }

  renderSuggestion(entry: BranchEntry, el: HTMLElement): void {
    el.classList.add("git-branch-suggestion");
    el.textContent = entry.type === "create" ? `Create branch: ${entry.name}` : entry.name;
    if (entry.current) {
      const badge = el.ownerDocument.createElement("span");
      badge.className = "git-branch-current-badge";
      badge.textContent = "current";
      el.appendChild(badge);
    }
  }

  onChooseSuggestion(entry: BranchEntry): void {
    if (entry.current) return;
    const run =
      entry.type === "create"
        ? this.app.git.createBranch(entry.name)
        : this.app.git.switchBranch(entry.name);
    void run.then((error) => {
      if (error) new Notice(`git: ${error}`);
      else new Notice(entry.type === "create" ? `Created ${entry.name}` : `On ${entry.name}`);
    });
  }
}
