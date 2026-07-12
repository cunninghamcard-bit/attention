import { FileDiff } from "@pierre/diffs";
import { ItemView } from "../../views/ItemView";
import { openGitDiff } from "../../views/DiffView";
import { openPrList } from "./GitPrViews";
import { openGitReview } from "./review/GitReviewView";
import { setIcon } from "../../ui/Icon";
import { setTooltip } from "../../ui/Popover";
import { Notice } from "../../ui/Notice";
import { hasUnstagedChanges, isStaged, type GitFileStatus } from "./GitService";

const MAX_RENDERED_FILES = 50;

/**
 * Source control: staged/unstaged sections with per-file stage buttons and a
 * commit box, each file rendered as a read-only unified diff via
 * @pierre/diffs (Shiki highlighting, inline word diffs, collapsed context).
 * Clicking a file header opens the editable @codemirror/merge review. The
 * split of libraries is deliberate: read-many here, edit-one there.
 */
export class GitChangesView extends ItemView {
  static readonly VIEW_TYPE = "git-changes";
  private listEl: HTMLElement | null = null;
  private commitEl: HTMLTextAreaElement | null = null;
  private commitButtonEl: HTMLButtonElement | null = null;
  private diffs: FileDiff[] = [];
  private refreshing = false;

  getViewType(): string { return GitChangesView.VIEW_TYPE; }
  getDisplayText(): string { return "Git changes"; }
  getIcon(): string { return "lucide-git-commit"; }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("git-changes-view");
    const doc = this.contentEl.ownerDocument;
    const commitRow = doc.createElement("div");
    commitRow.className = "git-commit-row";
    this.commitEl = doc.createElement("textarea");
    this.commitEl.className = "git-commit-message";
    this.commitEl.placeholder = "Commit message";
    this.commitEl.rows = 2;
    this.commitEl.addEventListener("input", () => this.updateCommitButton());
    this.commitButtonEl = doc.createElement("button");
    this.commitButtonEl.className = "git-commit-button mod-cta";
    this.commitButtonEl.textContent = "Commit";
    this.commitButtonEl.addEventListener("click", () => void this.commit());
    commitRow.append(this.commitEl, this.commitButtonEl);
    this.contentEl.appendChild(commitRow);

    this.listEl = doc.createElement("div");
    this.listEl.className = "git-changes-list";
    this.contentEl.appendChild(this.listEl);
    this.addAction("lucide-file-diff", "Review all changes", () => void openGitReview(this.app));
    this.addAction("lucide-git-pull-request", "Pull requests", () => void openPrList(this.app));
    this.addAction("lucide-rotate-ccw", "Refresh", () => void this.refresh());
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.disposeDiffs();
    await super.onClose();
  }

  async refresh(): Promise<void> {
    if (!this.listEl || this.refreshing) return;
    this.refreshing = true;
    try {
      this.disposeDiffs();
      this.listEl.replaceChildren();
      if (!this.app.git.isAvailable()) {
        this.setCommitVisible(false);
        this.renderMessage("Git is not available in this runtime. Open the desktop app inside a git repository.");
        return;
      }
      if (!(await this.app.git.isRepository())) {
        this.setCommitVisible(false);
        this.renderMessage("This vault is not a git repository.");
        return;
      }
      this.setCommitVisible(true);
      const status = await this.app.git.status();
      if (status.length === 0) {
        this.renderMessage("Working tree clean — no changes.");
        this.updateCommitButton(0);
        return;
      }
      const staged = status.filter(isStaged);
      const unstaged = status.filter(hasUnstagedChanges);
      this.updateCommitButton(staged.length);
      let budget = MAX_RENDERED_FILES;
      budget = await this.renderSection("Staged", staged, budget, true);
      await this.renderSection("Changes", unstaged, budget, false);
    } finally {
      this.refreshing = false;
    }
  }

  private async renderSection(title: string, entries: GitFileStatus[], budget: number, stagedSection: boolean): Promise<number> {
    if (!this.listEl || entries.length === 0) return budget;
    const doc = this.listEl.ownerDocument;
    const headingEl = doc.createElement("div");
    headingEl.className = "git-changes-section";
    headingEl.textContent = `${title} (${entries.length})`;
    this.listEl.appendChild(headingEl);
    for (const entry of entries) {
      if (budget <= 0) {
        this.renderMessage(`…and ${entries.length} more changed files.`);
        break;
      }
      budget -= 1;
      await this.renderEntry(entry, stagedSection);
    }
    return budget;
  }

  private async renderEntry(entry: GitFileStatus, stagedSection: boolean): Promise<void> {
    if (!this.listEl) return;
    const doc = this.listEl.ownerDocument;
    const sectionEl = doc.createElement("div");
    sectionEl.className = "git-changes-file";

    const headerEl = doc.createElement("div");
    headerEl.className = "git-changes-file-header tappable";
    const iconEl = doc.createElement("span");
    iconEl.className = "git-changes-file-icon";
    setIcon(iconEl, "lucide-file-diff");
    const nameEl = doc.createElement("span");
    nameEl.className = "git-changes-file-name";
    nameEl.textContent = entry.path;
    const statusEl = doc.createElement("span");
    statusEl.className = `git-changes-file-status mod-${statusLabel(entry.status)}`;
    statusEl.textContent = statusLabel(entry.status);
    const stageEl = doc.createElement("button");
    stageEl.className = "git-changes-stage clickable-icon";
    setIcon(stageEl, stagedSection ? "lucide-minus" : "lucide-plus");
    setTooltip(stageEl, stagedSection ? "Unstage" : "Stage");
    stageEl.addEventListener("click", (event) => {
      event.stopPropagation();
      void (stagedSection ? this.app.git.unstage([entry.path]) : this.app.git.stage([entry.path]))
        .then(() => this.refresh());
    });
    headerEl.append(iconEl, nameEl, statusEl, stageEl);
    headerEl.addEventListener("click", () => {
      const file = this.app.vault.getFileByPath(entry.path);
      if (file) void openGitDiff(this.app, file);
    });
    sectionEl.appendChild(headerEl);
    // Attach before rendering: the async highlight pass measures the DOM.
    this.listEl.appendChild(sectionEl);

    // Staged section diffs HEAD→index; Changes section diffs index→worktree,
    // so each hunk appears exactly once, in the section that owns it.
    const baseContents = stagedSection
      ? (await this.app.git.readHeadFile(entry.path)) ?? ""
      : (await this.app.git.readIndexFile(entry.path)) ?? (await this.app.git.readHeadFile(entry.path)) ?? "";
    const workingFile = this.app.vault.getFileByPath(entry.path);
    const targetContents = stagedSection
      ? (await this.app.git.readIndexFile(entry.path)) ?? ""
      : entry.status.includes("D") || !workingFile ? "" : await this.app.vault.read(workingFile);
    if (isProbablyBinary(baseContents) || isProbablyBinary(targetContents)) {
      const binaryEl = doc.createElement("div");
      binaryEl.className = "git-changes-binary";
      binaryEl.textContent = "Binary file";
      sectionEl.appendChild(binaryEl);
      return;
    }
    const diffContainer = doc.createElement("div");
    sectionEl.appendChild(diffContainer);
    const diff = new FileDiff({
      diffStyle: "unified",
      themeType: document.body.classList.contains("theme-dark") ? "dark" : "light",
    });
    // containerWrapper (not fileContainer): the library creates its own
    // <diffs-container> custom element whose shadow root carries the core
    // layout stylesheet via adoptedStyleSheets. A plain div renders unstyled.
    diff.render({
      oldFile: { name: entry.path, contents: baseContents },
      newFile: { name: entry.path, contents: targetContents },
      containerWrapper: diffContainer,
    });
    this.diffs.push(diff);
  }

  private async commit(): Promise<void> {
    const message = this.commitEl?.value.trim() ?? "";
    if (!message) return;
    const error = await this.app.git.commit(message);
    if (error) {
      new Notice(`Commit failed: ${error}`);
      return;
    }
    new Notice("Committed");
    if (this.commitEl) this.commitEl.value = "";
    await this.refresh();
  }

  private updateCommitButton(stagedCount?: number): void {
    if (!this.commitButtonEl) return;
    const message = this.commitEl?.value.trim() ?? "";
    if (stagedCount !== undefined) this.commitButtonEl.dataset.staged = String(stagedCount);
    const staged = Number(this.commitButtonEl.dataset.staged ?? "0");
    this.commitButtonEl.disabled = staged === 0 || message.length === 0;
    this.commitButtonEl.textContent = staged > 0 ? `Commit (${staged})` : "Commit";
  }

  private setCommitVisible(visible: boolean): void {
    const row = this.contentEl.querySelector<HTMLElement>(".git-commit-row");
    if (row) row.style.display = visible ? "" : "none";
  }

  private disposeDiffs(): void {
    for (const diff of this.diffs) diff.cleanUp();
    this.diffs = [];
  }

  private renderMessage(text: string): void {
    if (!this.listEl) return;
    const messageEl = this.listEl.ownerDocument.createElement("div");
    messageEl.className = "git-changes-message";
    messageEl.textContent = text;
    this.listEl.appendChild(messageEl);
  }
}

function isProbablyBinary(contents: string): boolean {
  return contents.includes("\0");
}

function statusLabel(status: string): string {
  if (status.includes("?")) return "untracked";
  if (status.includes("A")) return "added";
  if (status.includes("D")) return "deleted";
  if (status.includes("R")) return "renamed";
  return "modified";
}
