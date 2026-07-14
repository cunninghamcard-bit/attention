import type { App } from "../../../app/App";
import { createDiv, createEl, createSpan } from "../../../dom/dom";
import type { EventRef } from "../../../core/Events";
import { setIcon } from "../../../ui/Icon";
import { setFileTypeIcon } from "../../../ui/FileTypeIcon";
import { SearchComponent } from "../../../ui/Setting";
import { ItemView } from "../../../views/ItemView";
import type { GitLogEntry } from "../GitService";
import type { GitNavMode, GitReviewSource, ReviewFileSummary } from "../reviewSession";
import { formatRelativeDate } from "../relativeDate";
import {
  buildFileTree,
  buildHistoryRows,
  historyRowSelected,
  loadFileSummaries,
  type HistoryRow,
  type TreeNode,
} from "./reviewNavModel";

const HISTORY_PAGE = 50;
const GIT_STATUS_LABEL: Record<ReviewFileSummary["status"], string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
  untracked: "U",
};

/** Codiff's Tree | History navigator, docked in the right sidebar.
 * Pure navigation — committing lives in the git-composer view. */
export class GitNavView extends ItemView {
  static readonly VIEW_TYPE = "git-nav";

  private mode: GitNavMode = "tree";
  private files: ReviewFileSummary[] = [];
  private source: GitReviewSource = { kind: "working-tree" };
  private selectedPath: string | null = null;
  private viewedPaths = new Set<string>();
  private filter = "";
  private history: GitLogEntry[] = [];
  private historyLimit = HISTORY_PAGE;
  private historyLoading = false;
  private historyHasMore = true;
  private historyRequest = 0;
  private summaryRequest = 0;
  private collapsed = new Set<string>();
  private sessionRefs: EventRef[] = [];

  private searchComponent: SearchComponent | null = null;
  private bodyEl: HTMLDivElement | null = null;
  private footerEl: HTMLDivElement | null = null;

  getViewType(): string {
    return GitNavView.VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Git";
  }

  getIcon(): string {
    return "lucide-git-branch";
  }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("git-nav-view");
    const session = this.app.git.reviewSession;
    this.mode = session.mode;
    this.source = session.source;
    this.selectedPath = session.selectedPath;
    this.viewedPaths = new Set(session.viewedPaths);
    this.files = [...session.files];
    this.buildShell();
    this.sessionRefs = [
      session.on<[GitReviewSource]>("source-change", (source) => {
        this.source = source;
        this.render();
        if (this.centerless()) void this.loadSummaries();
      }),
      session.on<[ReviewFileSummary[]]>("files-change", (files) => {
        this.files = [...files];
        this.render();
      }),
      session.on<[string | null]>("path-change", (path) => this.applySelection(path)),
      session.on<[ReadonlySet<string>]>("viewed-change", (paths) => {
        this.viewedPaths = new Set(paths);
        this.renderBody();
      }),
      session.on<[GitNavMode]>("mode-change", (mode) => {
        this.mode = mode;
        this.render();
        if (mode === "history" && this.history.length === 0) void this.loadHistory(HISTORY_PAGE);
      }),
    ];
    this.render();
    if (this.mode === "history") void this.loadHistory(HISTORY_PAGE);
    if (this.files.length === 0) void this.loadSummaries();
  }

  async onClose(): Promise<void> {
    this.historyRequest += 1;
    this.summaryRequest += 1;
    for (const ref of this.sessionRefs) this.app.git.reviewSession.offref(ref);
    this.sessionRefs = [];
    this.contentEl.empty();
    await super.onClose();
  }

  private buildShell(): void {
    this.contentEl.empty();
    const root = createDiv("git-nav", this.contentEl);
    // The Tree/History switch lives in the center review toolbar, not here —
    // a sidebar is a poor home for a mode toggle. This leaf is a pure list.
    const searchRow = createDiv("git-nav-search-row", root);
    this.searchComponent = new SearchComponent(searchRow)
      .setClass("git-nav-search")
      .onChange((value) => {
        this.filter = value;
        this.renderBody();
      });
    this.searchComponent.inputEl.setAttribute("aria-label", "Filter changed files");

    this.bodyEl = createDiv("git-nav-tree", root);
    this.bodyEl.addEventListener("scroll", () => this.maybeLoadMoreHistory(), { passive: true });
    this.footerEl = createDiv("git-nav-footer", root);
  }

  private render(): void {
    if (!this.searchComponent) return;
    this.searchComponent
      .setValue(this.filter)
      .setPlaceholder(this.mode === "history" ? "Filter history" : "Filter files");
    this.searchComponent.inputEl.setAttribute(
      "aria-label",
      this.mode === "history" ? "Filter history" : "Filter changed files",
    );
    this.renderBody();
    this.renderFooter();
  }

  private renderBody(): void {
    if (!this.bodyEl) return;
    this.bodyEl.className = this.mode === "history" ? "git-nav-history" : "git-nav-tree";
    this.bodyEl.empty();
    if (this.mode === "history") this.renderHistory();
    else this.renderTree();
  }

  private renderTree(): void {
    if (!this.bodyEl) return;
    const query = this.query();
    const files = query
      ? this.files.filter((file) => file.path.toLowerCase().includes(query))
      : this.files;
    const tree = buildFileTree(files);
    if (tree.length === 0) {
      createDiv(
        {
          cls: "git-nav-empty",
          text: this.files.length === 0 ? "No changed files." : "No files match.",
        },
        this.bodyEl,
      );
      return;
    }
    for (const node of tree) this.bodyEl.append(this.renderTreeNode(node));
  }

  private renderTreeNode(node: TreeNode): HTMLElement {
    if (node.kind === "folder") {
      const collapsed = this.collapsed.has(node.path);
      const folder = createDiv(
        `tree-item nav-folder git-nav-folder${collapsed ? " is-collapsed" : ""}`,
      );
      const row = createDiv(
        {
          cls: "tree-item-self nav-folder-title tappable is-clickable mod-collapsible git-nav-folder-row",
          attr: { role: "button", tabindex: "0", "aria-expanded": String(!collapsed) },
        },
        folder,
      );
      const chevron = createSpan(
        `tree-item-icon collapse-icon nav-folder-collapse-indicator${collapsed ? " is-collapsed" : ""}`,
        row,
      );
      setIcon(chevron, "right-triangle");
      createSpan({ cls: "tree-item-inner nav-folder-title-content", text: node.name }, row);
      const toggle = (): void => {
        if (collapsed) this.collapsed.delete(node.path);
        else this.collapsed.add(node.path);
        this.renderBody();
      };
      row.addEventListener("click", toggle);
      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggle();
      });
      const children = createDiv("tree-item-children nav-folder-children", folder);
      children.hidden = collapsed;
      if (!collapsed) {
        for (const child of node.children) children.append(this.renderTreeNode(child));
      }
      return folder;
    }

    const file = createDiv("tree-item nav-file");
    const row = createDiv(
      {
        cls: `tree-item-self nav-file-title tappable is-clickable git-nav-file-row${
          this.selectedPath === node.path ? " is-active" : ""
        }${this.viewedPaths.has(node.path) ? " is-viewed is-cut" : ""}`,
        attr: { role: "button", tabindex: "0", title: node.path },
      },
      file,
    );
    row.dataset.path = node.path;
    const icon = createSpan("tree-item-icon nav-file-icon git-nav-file-icon", row);
    setFileTypeIcon(icon, node.path);
    createSpan({ cls: "tree-item-inner nav-file-title-content", text: node.name }, row);
    const flair = createSpan("tree-item-flair-outer", row);
    const stat = createSpan("tree-item-flair git-nav-file-stat", flair);
    if (node.additions > 0) createEl("ins", { text: `+${node.additions}` }, stat);
    if (node.deletions > 0) createEl("del", { text: `−${node.deletions}` }, stat);
    createSpan(
      {
        cls: `tree-item-flair git-nav-file-status mod-${node.status}`,
        text: GIT_STATUS_LABEL[node.status],
        attr: { title: `Git status: ${node.status}`, "aria-label": `Git status: ${node.status}` },
      },
      flair,
    );
    const activate = (): void => {
      this.app.git.reviewSession.activatePath(node.path);
      void this.ensureReviewLeaf();
    };
    row.addEventListener("click", activate);
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activate();
    });
    return file;
  }

  private renderHistory(): void {
    if (!this.bodyEl) return;
    const query = this.query();
    const rows = buildHistoryRows(this.history).filter((row) => this.historyMatches(row, query));
    for (const row of rows) this.bodyEl.append(this.renderHistoryRow(row));
    if (rows.length === 0 && !this.historyLoading) {
      createDiv(
        { cls: "git-nav-empty", text: query ? "No history matches." : "No history." },
        this.bodyEl,
      );
    }
    if (this.historyLoading)
      createDiv({ cls: "git-nav-empty", text: "Loading history…" }, this.bodyEl);
  }

  private historyMatches(row: HistoryRow, query: string): boolean {
    if (!query) return true;
    if (row.kind === "working-tree") return row.subject.toLowerCase().includes(query);
    return [row.subject, row.shortHash, row.author].some((value) =>
      value.toLowerCase().includes(query),
    );
  }

  private renderHistoryRow(row: HistoryRow): HTMLElement {
    const selected = historyRowSelected(row, this.source);
    const item = createDiv({
      cls: `tree-item-self git-nav-history-entry is-clickable${selected ? " is-active" : ""}`,
      attr: {
        role: "button",
        tabindex: "0",
        title: row.subject,
        "aria-current": selected ? "true" : "false",
      },
    });
    const inner = createDiv("tree-item-inner", item);
    createDiv({ cls: "tree-item-inner-text", text: row.subject }, inner);
    createDiv(
      {
        cls: "tree-item-inner-subtext",
        text:
          row.kind === "working-tree"
            ? "local"
            : `${row.shortHash} · ${row.author} · ${formatRelativeDate(row.date)}`,
      },
      inner,
    );
    const activate = (): void => {
      if (row.kind === "commit") {
        this.app.git.reviewSession.setSource({
          kind: "commit",
          ref: row.ref,
          subject: row.subject,
        });
      } else {
        this.app.git.reviewSession.setSource({ kind: "working-tree" });
      }
      void this.ensureReviewLeaf();
    };
    item.addEventListener("click", activate);
    item.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activate();
    });
    return item;
  }

  private renderFooter(): void {
    if (!this.footerEl) return;
    this.footerEl.empty();
    this.footerEl.hidden = this.mode !== "tree";
    if (this.mode !== "tree") return;
    createSpan(
      {
        cls: "git-nav-footer-summary",
        text:
          this.files.length === 0
            ? "No files"
            : `${this.files.length} file${this.files.length === 1 ? "" : "s"}`,
      },
      this.footerEl,
    );
    if (this.files.length === 0) return;
    const stat = createSpan("git-nav-footer-stat", this.footerEl);
    createEl(
      "ins",
      { text: `+${this.files.reduce((sum, file) => sum + file.additions, 0)}` },
      stat,
    );
    createEl(
      "del",
      { text: `−${this.files.reduce((sum, file) => sum + file.deletions, 0)}` },
      stat,
    );
  }

  private async loadHistory(limit: number): Promise<void> {
    const request = ++this.historyRequest;
    if (!this.app.git.isAvailable()) {
      this.history = [];
      this.historyHasMore = false;
      this.renderBody();
      return;
    }
    this.historyLoading = true;
    this.renderBody();
    try {
      const history = await this.app.git.log(undefined, limit);
      if (request !== this.historyRequest) return;
      this.history = history;
      this.historyLimit = limit;
      this.historyHasMore = history.length >= limit;
    } finally {
      if (request === this.historyRequest) {
        this.historyLoading = false;
        this.renderBody();
      }
    }
  }

  private maybeLoadMoreHistory(): void {
    if (
      this.mode !== "history" ||
      this.query() ||
      this.historyLoading ||
      !this.historyHasMore ||
      !this.bodyEl
    )
      return;
    if (this.bodyEl.scrollHeight - this.bodyEl.scrollTop - this.bodyEl.clientHeight < 120) {
      void this.loadHistory(this.historyLimit + HISTORY_PAGE);
    }
  }

  private query(): string {
    return this.filter.trim().toLowerCase();
  }

  /** Selection sync is imperative — rebuilding the tree per scroll tick is
   * exactly the jank this avoids. */
  private applySelection(path: string | null): void {
    this.selectedPath = path;
    if (this.mode !== "tree" || !this.bodyEl) return;
    for (const row of this.bodyEl.querySelectorAll(".git-nav-file-row.is-active")) {
      row.classList.remove("is-active");
    }
    if (path) {
      const escaped = path.replace(/["\\]/g, "\\$&");
      this.bodyEl.querySelector(`[data-path="${escaped}"]`)?.classList.add("is-active");
    }
  }

  private centerless(): boolean {
    return this.app.workspace.getLeavesOfType("git-review").length === 0;
  }

  /** The nav is self-sufficient: without a center leaf, it computes its own
   * file summaries (status + numstat, no diff bodies) for the active source. */
  private async loadSummaries(): Promise<void> {
    const request = ++this.summaryRequest;
    const git = this.app.git;
    if (!git.isAvailable() || !(await git.isRepository())) return;
    const summaries = await loadFileSummaries(git, this.source);
    if (request !== this.summaryRequest) return;
    this.app.git.reviewSession.publishFiles(summaries);
  }

  /** The nav drives the center: open the review leaf if missing, surface it
   * otherwise (outline-view idiom). View type by string — a GitReviewView
   * import here would be circular. */
  private async ensureReviewLeaf(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType("git-review");
    if (leaves.length === 0) {
      await this.app.workspace
        .getLeaf("tab")
        .setViewState({ type: "git-review", active: true, state: { source: this.source } });
    } else {
      await this.app.workspace.revealLeaf(leaves[0]);
    }
  }
}

/** Opens (or focuses) the right-docked git navigator. */
export async function openGitNav(app: App, reveal = true, mode?: GitNavMode): Promise<void> {
  if (mode) app.git.reviewSession.setMode(mode);
  await app.workspace.ensureSideLeaf(GitNavView.VIEW_TYPE, "right", {
    active: true,
    reveal,
  });
}
