import { FileDiff } from "@pierre/diffs";
import { ItemView } from "../../views/ItemView";
import { openGitDiff } from "../../views/DiffView";
import { openPrList } from "../github/GitPrViews";
import { openGitReview } from "./review/GitReviewView";
import { setIcon } from "../../ui/Icon";
import { TreeItem } from "../../ui/TreeItem";
import { setTooltip } from "../../ui/Popover";
import { Notice } from "../../ui/Notice";
import { hasUnstagedChanges, isStaged, type GitFileStatus } from "./GitService";
import { BranchSwitchModal } from "./BranchSwitchModal";
import { ConfirmationModal } from "../../ui/Modal";
import { setFileTypeIcon } from "../../ui/FileTypeIcon";

const MAX_RENDERED_FILES = 50;

/**
 * Source control: branch/sync header plus staged/unstaged sections with
 * per-file stage and discard buttons, each file rendered as a read-only
 * unified diff via @pierre/diffs (Shiki highlighting, inline word diffs,
 * collapsed context). Clicking a file header opens the editable
 * @codemirror/merge review. Committing is out of scope — this vault is a
 * review tool; author commits from the terminal.
 */
export class GitChangesView extends ItemView {
  static readonly VIEW_TYPE = "git-changes";
  private listEl: HTMLElement | null = null;
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

    this.listEl = doc.createElement("div");
    this.listEl.className = "git-changes-list";
    this.contentEl.appendChild(this.listEl);
    this.addAction("lucide-file-diff", "Review all changes", () => void openGitReview(this.app));
    this.addAction("lucide-git-pull-request", "Pull requests", () => void openPrList(this.app));
    this.addAction("lucide-rotate-ccw", "Refresh", () => void this.refresh());
    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        const themeType = document.body.classList.contains("theme-dark") ? "dark" : "light";
        for (const diff of this.diffs) diff.setThemeType(themeType);
      }),
    );
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
        this.renderMessage(
          "Git is not available in this runtime. Open the desktop app inside a git repository.",
        );
        return;
      }
      if (!(await this.app.git.isRepository())) {
        this.setHeaderVisible(false);
        this.renderMessage("This vault is not a git repository.");
        return;
      }
      await this.refreshHeader();
      const status = await this.app.git.status();
      if (status.length === 0) {
        this.renderMessage("Working tree clean — no changes.");
        return;
      }
      const staged = status.filter(isStaged);
      const unstaged = status.filter(hasUnstagedChanges);
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
    // Native source-control shape: the section is a collapsible tree parent,
    // its files nested in the shared tree-item-children box.
    const section = new TreeItem(this.listEl, {
      itemClass: "nav-folder git-changes-section-item",
      selfClass: "nav-folder-title tappable is-clickable git-changes-section",
      childrenClass: "nav-folder-children",
      collapseClass: "nav-folder-collapse-indicator",
    });
    section.setCollapsible(true);
    section.setCollapsed(false);
    section.innerEl.textContent = title;
    const countEl = doc.createElement("span");
    countEl.className = "tree-item-flair";
    countEl.textContent = String(entries.length);
    section.innerEl.after(countEl);
    // Clicking anywhere on the header toggles; the chevron click bubbles to
    // selfEl, so neuter onCollapseClick to avoid a double toggle (GitLogView idiom).
    section.onSelfClick = () => section.toggleCollapsed();
    section.onCollapseClick = () => {};
    for (const entry of entries) {
      if (budget <= 0) {
        this.renderMessage(`…and ${entries.length} more changed files.`);
        break;
      }
      budget -= 1;
      await this.renderEntry(entry, stagedSection, section.childrenEl);
    }
    return budget;
  }

  private async renderEntry(
    entry: GitFileStatus,
    stagedSection: boolean,
    parentEl: HTMLElement,
  ): Promise<void> {
    const doc = parentEl.ownerDocument;
    // The TreeItem constructor attaches el to parentEl, so the row is connected
    // before the async highlight pass below measures the DOM.
    const item = new TreeItem(parentEl, {
      itemClass: "nav-file git-changes-file",
      selfClass: "nav-file-title tappable is-clickable git-changes-file-header",
      innerClass: "nav-file-title-content git-changes-file-name",
    });
    const { el: sectionEl, innerEl: nameEl } = item;
    const iconEl = doc.createElement("span");
    iconEl.className = "tree-item-icon nav-file-icon";
    setFileTypeIcon(iconEl, entry.path);
    nameEl.textContent = entry.path;
    const flairEl = doc.createElement("span");
    flairEl.className = "tree-item-flair-outer";
    const statusEl = doc.createElement("span");
    statusEl.className = `tree-item-flair git-changes-file-status mod-${statusLabel(entry.status)}`;
    statusEl.textContent = statusLabel(entry.status);
    flairEl.appendChild(statusEl);
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
      flairEl.append(discardEl, stageEl);
    } else {
      flairEl.append(stageEl);
    }
    // Row content order: icon, name (innerEl), flair — same as the hand-built row.
    nameEl.before(iconEl);
    nameEl.after(flairEl);
    item.onSelfClick = () => {
      const file = this.app.vault.getFileByPath(entry.path);
      if (file) void openGitDiff(this.app, file);
    };

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
      binaryEl.className = "tree-item-inner-subtext git-changes-binary";
      binaryEl.textContent = "Binary file";
      // Diff is the file's own content, not a nested tree row: keep it a direct
      // child of the tree-item (before the unused leaf childrenEl), full-width.
      sectionEl.insertBefore(binaryEl, item.childrenEl);
      return;
    }
    const diffContainer = doc.createElement("div");
    sectionEl.insertBefore(diffContainer, item.childrenEl);
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
    messageEl.className = "empty-state git-changes-message";
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
