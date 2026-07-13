import { FileDiff } from "@pierre/diffs";
import { ItemView } from "../../views/ItemView";
import { openGitDiff } from "../../views/DiffView";
import { openPrList } from "../github/GitPrViews";
import { openGitReview } from "./review/GitReviewView";
import { setIcon } from "../../ui/Icon";
import { setTooltip } from "../../ui/Popover";
import { Notice } from "../../ui/Notice";
import { hasUnstagedChanges, isStaged, type GitFileStatus } from "./GitService";
import { BranchSwitchModal } from "./BranchSwitchModal";
import { ConfirmationModal } from "../../ui/Modal";

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
  private amendEl: HTMLInputElement | null = null;
  private branchEl: HTMLButtonElement | null = null;
  private divergenceEl: HTMLElement | null = null;
  private syncBusy = false;
  private diffs: FileDiff[] = [];
  private refreshing = false;

  getViewType(): string {
    return GitChangesView.VIEW_TYPE;
  }
  getDisplayText(): string {
    return "Git changes";
  }
  getIcon(): string {
    return "lucide-git-commit";
  }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("git-changes-view");
    const doc = this.contentEl.ownerDocument;

    const headerRow = doc.createElement("div");
    headerRow.className = "git-header-row";
    this.branchEl = doc.createElement("button");
    this.branchEl.className = "git-branch-pill clickable-icon";
    setTooltip(this.branchEl, "Switch branch");
    this.branchEl.addEventListener("click", () => new BranchSwitchModal(this.app).open());
    this.divergenceEl = doc.createElement("span");
    this.divergenceEl.className = "git-divergence";
    const syncActions = doc.createElement("div");
    syncActions.className = "git-sync-actions";
    for (const [icon, label, verb] of [
      ["lucide-refresh-cw", "Fetch", () => this.app.git.fetch()],
      ["lucide-arrow-down", "Pull (fast-forward)", () => this.app.git.pull()],
      ["lucide-arrow-up", "Push", () => this.app.git.push()],
    ] as const) {
      const buttonEl = doc.createElement("button");
      buttonEl.className = "git-sync-button clickable-icon";
      setIcon(buttonEl, icon);
      setTooltip(buttonEl, label);
      buttonEl.addEventListener("click", () => void this.runSync(label, verb));
      syncActions.appendChild(buttonEl);
    }
    headerRow.append(this.branchEl, this.divergenceEl, syncActions);
    this.contentEl.appendChild(headerRow);

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
    const amendLabel = doc.createElement("label");
    amendLabel.className = "git-amend-label";
    this.amendEl = doc.createElement("input");
    this.amendEl.type = "checkbox";
    this.amendEl.addEventListener("change", () => this.updateCommitButton());
    amendLabel.append(this.amendEl, doc.createTextNode("Amend"));
    commitRow.append(this.commitEl, amendLabel, this.commitButtonEl);
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
        this.setHeaderVisible(false);
        this.setCommitVisible(false);
        this.renderMessage(
          "Git is not available in this runtime. Open the desktop app inside a git repository.",
        );
        return;
      }
      if (!(await this.app.git.isRepository())) {
        this.setHeaderVisible(false);
        this.setCommitVisible(false);
        this.renderMessage("This vault is not a git repository.");
        return;
      }
      this.setCommitVisible(true);
      await this.refreshHeader();
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

  private async renderSection(
    title: string,
    entries: GitFileStatus[],
    budget: number,
    stagedSection: boolean,
  ): Promise<number> {
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
      void (
        stagedSection ? this.app.git.unstage([entry.path]) : this.app.git.stage([entry.path])
      ).then(() => this.refresh());
    });
    if (!stagedSection) {
      const discardEl = doc.createElement("button");
      discardEl.className = "git-changes-discard clickable-icon";
      setIcon(discardEl, "lucide-undo-2");
      setTooltip(discardEl, entry.status[0] === "?" ? "Delete untracked file" : "Discard changes");
      discardEl.addEventListener("click", (event) => {
        event.stopPropagation();
        this.confirmDiscard(entry);
      });
      headerEl.append(iconEl, nameEl, statusEl, discardEl, stageEl);
    } else {
      headerEl.append(iconEl, nameEl, statusEl, stageEl);
    }
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
      ? ((await this.app.git.readHeadFile(entry.path)) ?? "")
      : ((await this.app.git.readIndexFile(entry.path)) ??
        (await this.app.git.readHeadFile(entry.path)) ??
        "");
    const workingFile = this.app.vault.getFileByPath(entry.path);
    const targetContents = stagedSection
      ? ((await this.app.git.readIndexFile(entry.path)) ?? "")
      : entry.status.includes("D") || !workingFile
        ? ""
        : await this.app.vault.read(workingFile);
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
    const amend = this.amendEl?.checked ?? false;
    const error = await this.app.git.commit(message, { amend });
    if (error) {
      new Notice(`Commit failed: ${error}`);
      return;
    }
    new Notice(amend ? "Amended" : "Committed");
    if (this.commitEl) this.commitEl.value = "";
    if (this.amendEl) this.amendEl.checked = false;
    await this.refresh();
  }

  private updateCommitButton(stagedCount?: number): void {
    if (!this.commitButtonEl) return;
    const message = this.commitEl?.value.trim() ?? "";
    if (stagedCount !== undefined) this.commitButtonEl.dataset.staged = String(stagedCount);
    const staged = Number(this.commitButtonEl.dataset.staged ?? "0");
    const amend = this.amendEl?.checked ?? false;
    this.commitButtonEl.disabled = (staged === 0 && !amend) || message.length === 0;
    this.commitButtonEl.textContent = amend
      ? "Amend"
      : staged > 0
        ? `Commit (${staged})`
        : "Commit";
  }

  private setCommitVisible(visible: boolean): void {
    const row = this.contentEl.querySelector<HTMLElement>(".git-commit-row");
    if (row) row.style.display = visible ? "" : "none";
  }

  private async refreshHeader(): Promise<void> {
    this.setHeaderVisible(true);
    const [branch, divergence] = await Promise.all([
      this.app.git.currentBranch(),
      this.app.git.aheadBehind(),
    ]);
    if (this.branchEl) {
      this.branchEl.replaceChildren();
      const iconEl = this.branchEl.ownerDocument.createElement("span");
      setIcon(iconEl, "lucide-git-branch");
      this.branchEl.append(
        iconEl,
        this.branchEl.ownerDocument.createTextNode(branch ?? "detached"),
      );
    }
    if (this.divergenceEl)
      this.divergenceEl.textContent = divergence
        ? `↑${divergence.ahead} ↓${divergence.behind}`
        : "";
  }

  private setHeaderVisible(visible: boolean): void {
    const row = this.contentEl.querySelector<HTMLElement>(".git-header-row");
    if (row) row.style.display = visible ? "" : "none";
  }

  private async runSync(label: string, verb: () => Promise<string | null>): Promise<void> {
    if (this.syncBusy) return;
    this.syncBusy = true;
    this.contentEl.classList.add("git-sync-busy");
    try {
      const error = await verb();
      if (error) new Notice(`${label} failed: ${error}`);
      else new Notice(`${label} done`);
    } finally {
      this.syncBusy = false;
      this.contentEl.classList.remove("git-sync-busy");
      await this.refresh();
    }
  }

  private confirmDiscard(entry: GitFileStatus): void {
    const untracked = entry.status[0] === "?";
    new ConfirmationModal(this.app)
      .setTitle(untracked ? "Delete untracked file?" : "Discard changes?")
      .setContent(
        untracked
          ? `${entry.path} is untracked — deleting it cannot be undone.`
          : `Local edits to ${entry.path} will be lost. This cannot be undone.`,
      )
      .addButton("mod-warning", untracked ? "Delete" : "Discard", () => {
        void this.app.git.discard([entry]).then((ok) => {
          if (!ok) new Notice("git: discard failed");
          void this.refresh();
        });
      })
      .addCancelButton()
      .open();
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
