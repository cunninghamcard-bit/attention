import { ItemView } from "../../views/ItemView";
import { openFileDiff } from "../../views/DiffView";
import type { ViewStateResult } from "../../views/View";
import { Notice } from "../../ui/Notice";
import { renderGitAvatar } from "./GitAvatar";
import { formatRelativeDate } from "./relativeDate";
import type { GitLogEntry } from "./GitService";
import { openGitReview } from "./review/GitReviewView";
import { setIcon } from "../../ui/Icon";
import { setTooltip } from "../../ui/Popover";
import { TreeItem } from "../../ui/TreeItem";

/**
 * Commit history for one file (git log --follow). Each entry offers the two
 * things a history is for: read the file as it was at that commit, and diff
 * the working copy against it — both through the existing DiffView, with the
 * historical version as the baseline.
 */
export class GitHistoryView extends ItemView {
  static readonly VIEW_TYPE = "git-history";
  private path: string | null = null;
  private listEl: HTMLElement | null = null;

  getViewType(): string {
    return GitHistoryView.VIEW_TYPE;
  }
  getDisplayText(): string {
    return this.path ? `History — ${this.path.split("/").pop()}` : "File history";
  }
  getIcon(): string {
    return "lucide-history";
  }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("git-history-view");
    this.listEl = this.contentEl.ownerDocument.createElement("div");
    this.listEl.className = "git-history-list";
    this.contentEl.appendChild(this.listEl);
    this.addAction("lucide-rotate-ccw", "Refresh", () => void this.refresh());
  }

  async setState(state: unknown, result?: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    if (
      state &&
      typeof state === "object" &&
      typeof (state as { path?: unknown }).path === "string"
    ) {
      this.path = (state as { path: string }).path;
      await this.refresh();
      this.leaf.updateHeader();
    }
  }

  getState(): Record<string, unknown> {
    return { path: this.path };
  }

  async refresh(): Promise<void> {
    if (!this.listEl || !this.path) return;
    this.listEl.replaceChildren();
    if (!this.app.git.isAvailable() || !(await this.app.git.isRepository())) {
      this.renderMessage("Git is not available for this vault.");
      return;
    }
    const entries = await this.app.git.log(this.path);
    if (entries.length === 0) {
      this.renderMessage("No commits touch this file yet.");
      return;
    }
    for (const entry of entries) this.renderEntry(entry);
  }

  private renderEntry(entry: GitLogEntry): void {
    if (!this.listEl || !this.path) return;
    const doc = this.listEl.ownerDocument;
    // Leaf history row via the shared primitive: TreeItem builds .tree-item /
    // .tree-item-self / .tree-item-inner; the view only layers its git classes
    // and hangs the actions flair off the self row. Not collapsible.
    const { selfEl: rowEl, innerEl: contentEl } = new TreeItem(this.listEl, {
      itemClass: "nav-file git-history-entry",
      selfClass: "nav-file-title tappable git-history-row",
      innerClass: "nav-file-title-content",
    });
    const subjectEl = doc.createElement("div");
    subjectEl.className = "tree-item-inner-text git-history-subject";
    subjectEl.textContent = entry.subject;
    const metaEl = doc.createElement("div");
    metaEl.className = "tree-item-inner-subtext git-history-meta";
    const authorEl = doc.createElement("span");
    authorEl.className = "git-commit-author";
    renderGitAvatar(authorEl, entry.author, entry.avatarUrl);
    const hashEl = doc.createElement("span");
    hashEl.className = "git-commit-hash";
    hashEl.textContent = entry.shortHash;
    metaEl.append(
      authorEl,
      doc.createTextNode(" · "),
      hashEl,
      doc.createTextNode(` · ${formatRelativeDate(entry.date)}`),
    );
    contentEl.append(subjectEl, metaEl);
    const actionsEl = doc.createElement("div");
    actionsEl.className = "tree-item-flair-outer git-history-actions";
    actionsEl.append(
      this.actionButton(
        "lucide-file-diff",
        "Review commit",
        () =>
          void openGitReview(this.app, { kind: "commit", ref: entry.hash, subject: entry.subject }),
      ),
      this.actionButton("lucide-eye", "View version", () => void this.viewVersion(entry)),
      this.actionButton(
        "lucide-git-compare",
        "Diff vs working",
        () => void this.diffAgainstWorking(entry),
      ),
    );
    rowEl.appendChild(actionsEl);
  }

  private actionButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const buttonEl = this.contentEl.ownerDocument.createElement("button");
    buttonEl.className = "clickable-icon git-history-action";
    setIcon(buttonEl, icon);
    setTooltip(buttonEl, label);
    buttonEl.setAttribute("aria-label", label);
    buttonEl.addEventListener("click", onClick);
    return buttonEl;
  }

  /** Opens the historical content read-only-ish: the diff of it vs itself is
   * empty, so the review surface doubles as a highlighted viewer. */
  private async viewVersion(entry: GitLogEntry): Promise<void> {
    if (!this.path) return;
    const content = await this.app.git.readFileAt(entry.hash, this.path);
    if (content === null) {
      new Notice("File does not exist at that commit");
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: "code",
      active: true,
      state: { file: await this.materializeSnapshot(entry, content) },
    });
  }

  private async diffAgainstWorking(entry: GitLogEntry): Promise<void> {
    if (!this.path) return;
    const file = this.app.vault.getFileByPath(this.path);
    if (!file) {
      new Notice("The file no longer exists in the working tree");
      return;
    }
    const original = (await this.app.git.readFileAt(entry.hash, this.path)) ?? "";
    await openFileDiff(this.app, file, original);
  }

  /** Historical snapshots land in a scratch folder so the code view (a file
   * view) can host them without touching the real file. */
  private async materializeSnapshot(entry: GitLogEntry, content: string): Promise<string> {
    const name = this.path!.split("/").pop()!;
    const folder = ".workbench/git-snapshots";
    if (!this.app.vault.getFolderByPath(folder)) {
      await this.app.vault.createFolder(".workbench").catch(() => {});
      await this.app.vault.createFolder(folder).catch(() => {});
    }
    const snapshotPath = `${folder}/${entry.shortHash}-${name}`;
    const existing = this.app.vault.getFileByPath(snapshotPath);
    if (existing) await this.app.vault.modify(existing, content);
    else await this.app.vault.create(snapshotPath, content);
    return snapshotPath;
  }

  private renderMessage(text: string): void {
    if (!this.listEl) return;
    const messageEl = this.listEl.ownerDocument.createElement("div");
    messageEl.className = "empty-state git-changes-message";
    messageEl.textContent = text;
    this.listEl.appendChild(messageEl);
  }
}

/** Opens the history view for a file path. */
export async function openFileHistory(
  app: import("../../app/App").App,
  path: string,
): Promise<void> {
  const leaf = app.workspace.getLeaf("tab");
  await leaf.setViewState({ type: GitHistoryView.VIEW_TYPE, active: true, state: { path } });
}
