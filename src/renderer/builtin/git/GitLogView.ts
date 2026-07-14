import { FileDiff } from "@pierre/diffs";
import { ItemView } from "../../views/ItemView";
import { setIcon } from "../../ui/Icon";
import { setFileTypeIcon } from "../../ui/FileTypeIcon";
import type { GitFileStatus, GitLogEntry, GitNumstatEntry, GitService } from "./GitService";

const LOG_LIMIT = 100;

export interface CommitFileRow {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

/** Merges name-status rows with numstat counts into one row per file. */
export function mergeCommitFileRows(
  statusRows: GitFileStatus[],
  numstat: GitNumstatEntry[],
): CommitFileRow[] {
  const counts = new Map(numstat.map((entry) => [entry.path, entry]));
  return statusRows.map((row) => ({
    path: row.path,
    status: row.status,
    additions: counts.get(row.path)?.additions ?? 0,
    deletions: counts.get(row.path)?.deletions ?? 0,
  }));
}

/** A commit's parent-side file content; empty for root commits or new files. */
export async function commitDiffBaseline(
  git: Pick<GitService, "readFileAt">,
  ref: string,
  path: string,
): Promise<string> {
  return (await git.readFileAt(`${ref}~1`, path)) ?? "";
}

/**
 * LOCAL commit log — repo-wide `git log`, fully offline. The cloud twin is
 * the GitHub workspace's Commits section; the two are deliberately separate
 * surfaces (local-first data must never require the network).
 */
export class GitLogView extends ItemView {
  static readonly VIEW_TYPE = "git-log";
  private listEl: HTMLElement | null = null;
  private diffs: FileDiff[] = [];

  getViewType(): string {
    return GitLogView.VIEW_TYPE;
  }
  getDisplayText(): string {
    return "Commit log";
  }
  getIcon(): string {
    return "lucide-history";
  }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("git-log-view");
    this.listEl = this.contentEl.ownerDocument.createElement("div");
    this.listEl.className = "git-log-list";
    this.contentEl.appendChild(this.listEl);
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
    if (!this.listEl) return;
    this.disposeDiffs();
    this.listEl.replaceChildren();
    if (!this.app.git.isAvailable() || !(await this.app.git.isRepository())) {
      this.renderMessage("Git is not available for this vault.");
      return;
    }
    const entries = await this.app.git.log(undefined, LOG_LIMIT);
    if (entries.length === 0) {
      this.renderMessage("No commits yet.");
      return;
    }
    for (const entry of entries) this.renderEntry(entry);
    if (entries.length === LOG_LIMIT)
      this.renderMessage(`Showing the latest ${LOG_LIMIT} commits.`);
  }

  private renderEntry(entry: GitLogEntry): void {
    if (!this.listEl) return;
    const doc = this.listEl.ownerDocument;
    const itemEl = doc.createElement("div");
    itemEl.className = "tree-item nav-folder git-log-entry";
    const headerEl = doc.createElement("div");
    headerEl.className =
      "tree-item-self nav-folder-title tappable is-clickable mod-collapsible git-log-header";
    const iconEl = doc.createElement("span");
    iconEl.className = "tree-item-icon collapse-icon is-collapsed";
    setIcon(iconEl, "right-triangle");
    const contentEl = doc.createElement("span");
    contentEl.className = "tree-item-inner";
    const subjectEl = doc.createElement("span");
    subjectEl.className = "git-log-subject";
    subjectEl.textContent = entry.subject;
    const metaEl = doc.createElement("span");
    metaEl.className = "tree-item-inner-subtext git-log-meta";
    metaEl.textContent = `${entry.shortHash} · ${entry.author} · ${new Date(entry.date).toLocaleString()}`;
    contentEl.append(subjectEl, metaEl);
    headerEl.append(iconEl, contentEl);
    itemEl.appendChild(headerEl);
    const detailEl = doc.createElement("div");
    detailEl.className = "tree-item-children nav-folder-children git-log-detail";
    detailEl.hidden = true;
    itemEl.appendChild(detailEl);
    let loaded = false;
    headerEl.addEventListener("click", () => {
      const open = !detailEl.hidden;
      detailEl.hidden = open;
      iconEl.classList.toggle("is-collapsed", open);
      itemEl.classList.toggle("is-expanded", !open);
      if (!open && !loaded) {
        loaded = true;
        void this.renderDetail(entry, detailEl);
      }
    });
    this.listEl.appendChild(itemEl);
  }

  private async renderDetail(entry: GitLogEntry, detailEl: HTMLElement): Promise<void> {
    const doc = detailEl.ownerDocument;
    const [statusRows, numstat] = await Promise.all([
      this.app.git.changedFilesIn(entry.hash),
      this.app.git.numstat(entry.hash),
    ]);
    const rows = mergeCommitFileRows(statusRows, numstat);
    if (rows.length === 0) {
      const emptyEl = doc.createElement("div");
      emptyEl.className = "git-log-meta";
      emptyEl.textContent = "No file changes recorded.";
      detailEl.appendChild(emptyEl);
      return;
    }
    for (const row of rows) {
      const rowEl = doc.createElement("div");
      rowEl.className =
        "tree-item-self nav-file-title tappable is-clickable mod-collapsible git-log-file";
      const iconEl = doc.createElement("span");
      iconEl.className = "tree-item-icon nav-file-icon";
      setFileTypeIcon(iconEl, row.path);
      const nameEl = doc.createElement("span");
      nameEl.className = "tree-item-inner nav-file-title-content git-log-file-name";
      nameEl.textContent = row.path;
      const statEl = doc.createElement("span");
      statEl.className = "tree-item-flair git-log-file-stats";
      statEl.textContent = `${row.status}  +${row.additions}  −${row.deletions}`;
      rowEl.append(iconEl, nameEl, statEl);
      detailEl.appendChild(rowEl);
      const diffHost = doc.createElement("div");
      diffHost.hidden = true;
      detailEl.appendChild(diffHost);
      let diffLoaded = false;
      rowEl.addEventListener("click", () => {
        const open = !diffHost.hidden;
        diffHost.hidden = open;
        if (!open && !diffLoaded) {
          diffLoaded = true;
          void this.renderFileDiff(entry.hash, row.path, diffHost);
        }
      });
    }
  }

  private async renderFileDiff(ref: string, path: string, host: HTMLElement): Promise<void> {
    const [before, after] = await Promise.all([
      commitDiffBaseline(this.app.git, ref, path),
      this.app.git.readFileAt(ref, path).then((content) => content ?? ""),
    ]);
    const diff = new FileDiff({
      diffStyle: "unified",
      themeType: document.body.classList.contains("theme-dark") ? "dark" : "light",
    });
    diff.render({
      oldFile: { name: path, contents: before },
      newFile: { name: path, contents: after },
      containerWrapper: host,
    });
    this.diffs.push(diff);
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
