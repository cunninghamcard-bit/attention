import { FileDiff } from "@pierre/diffs";
import { ItemView } from "../../views/ItemView";
import { setFileTypeIcon } from "../../ui/FileTypeIcon";
import { setIcon } from "../../ui/Icon";
import { TreeItem } from "../../ui/TreeItem";
import { renderGitAvatar } from "./GitAvatar";
import { formatRelativeDate } from "./relativeDate";
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
    const item = new TreeItem(this.listEl, {
      itemClass: "nav-folder git-log-entry",
      selfClass: "nav-folder-title tappable is-clickable git-log-header",
      childrenClass: "nav-folder-children git-log-detail",
      collapseClass: "nav-folder-collapse-indicator",
    });
    item.setCollapsible(true);
    item.setCollapsed(true);
    const { el: itemEl, childrenEl: detailEl, innerEl: contentEl } = item;
    const subjectEl = doc.createElement("span");
    subjectEl.className = "tree-item-inner-text git-log-subject";
    subjectEl.textContent = entry.subject;
    const metaEl = doc.createElement("span");
    metaEl.className = "tree-item-inner-subtext git-log-meta";
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
    let loaded = false;
    const toggle = (): void => {
      // .hidden is typed string | boolean (hidden="until-found"); it is only
      // ever set to a real boolean here, so coerce for classList.toggle.
      const expanding = Boolean(detailEl.hidden);
      item.setCollapsed(!expanding);
      itemEl.classList.toggle("is-expanded", expanding);
      if (expanding && !loaded) {
        loaded = true;
        void this.renderDetail(entry, detailEl);
      }
    };
    // Row and chevron behave identically: the chevron click bubbles to selfEl,
    // and onCollapseClick is neutered so it does not fight the lazy toggle.
    item.onSelfClick = toggle;
    item.onCollapseClick = () => {};
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
      // A changed file that expands to its diff — semantically a FILE, so it
      // wears nav-file(-title), not nav-folder. The distinction is load-bearing
      // under themes: a theme paints .nav-folder-title with folder colours and
      // reserves the file press/active treatment for .nav-file-title, so a file
      // row in folder clothes gets rendered as a folder. It stays collapsible;
      // the commit ABOVE it keeps nav-folder, which is the real container.
      const item = new TreeItem(detailEl, {
        itemClass: "nav-file git-log-file-item",
        selfClass: "nav-file-title tappable is-clickable git-log-file",
        innerClass: "nav-file-title-content git-log-file-name",
        childrenClass: "nav-folder-children",
        collapseClass: "nav-folder-collapse-indicator",
        iconClass: "nav-file-icon git-log-file-icon",
      });
      item.setCollapsible(true);
      item.setCollapsed(true);
      const { childrenEl: diffHost, innerEl: nameEl } = item;
      setFileTypeIcon(item.iconEl, row.path);
      nameEl.textContent = row.path;
      const statEl = doc.createElement("span");
      statEl.className = "tree-item-flair git-log-file-stats";
      statEl.textContent = `${row.status}  +${row.additions}  −${row.deletions}`;
      // Row order: chevron (gutter), file-type icon, name (innerEl), stats flair.
      nameEl.after(statEl);
      let diffLoaded = false;
      const toggle = (): void => {
        const expanding = Boolean(diffHost.hidden);
        item.setCollapsed(!expanding);
        if (expanding && !diffLoaded) {
          diffLoaded = true;
          void this.renderFileDiff(entry.hash, row.path, diffHost);
        }
      };
      item.onSelfClick = toggle;
      item.onCollapseClick = () => {};
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
