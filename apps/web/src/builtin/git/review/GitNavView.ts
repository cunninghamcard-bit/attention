import type { App } from "../../../app/App";
import { createDiv, createEl, createSpan } from "../../../dom/dom";
import type { EventRef } from "../../../core/Events";
import { setIcon } from "../../../ui/Icon";
import { setFileTypeIcon } from "../../../ui/FileTypeIcon";
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

  private searchEl: HTMLInputElement | null = null;
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
    this.searchEl = createEl(
      "input",
      {
        cls: "git-nav-search",
        attr: { type: "search", spellcheck: "false", "aria-label": "Filter changed files" },
      },
      searchRow,
    );
    this.searchEl.addEventListener("input", () => {
      this.filter = this.searchEl?.value ?? "";
      this.renderBody();
    });

    this.bodyEl = createDiv("git-nav-tree", root);
    this.bodyEl.addEventListener("scroll", () => this.maybeLoadMoreHistory(), { passive: true });
    this.footerEl = createDiv("git-nav-footer", root);
  }

  private render(): void {
    if (!this.searchEl) return;
    this.searchEl.value = this.filter;
    this.searchEl.placeholder = this.mode === "history" ? "Filter history" : "Filter files";
    this.searchEl.setAttribute(
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
    for (const node of tree) this.bodyEl.append(this.renderTreeNode(node, 0));
  }

  private renderTreeNode(node: TreeNode, depth: number): HTMLElement {
    if (node.kind === "folder") {
      const folder = createDiv("git-nav-folder");
      const collapsed = this.collapsed.has(node.path);
      const row = createEl(
        "button",
        {
          cls: "git-nav-folder-row",
          attr: { type: "button", "aria-expanded": String(!collapsed) },
        },
        folder,
      );
      row.style.paddingLeft = `${8 + depth * 12}px`;
      const chevron = createSpan("git-nav-folder-chevron", row);
      setIcon(chevron, collapsed ? "lucide-chevron-right" : "lucide-chevron-down");
      createSpan({ cls: "git-nav-folder-name", text: node.name }, row);
      row.addEventListener("click", () => {
        if (collapsed) this.collapsed.delete(node.path);
        else this.collapsed.add(node.path);
        this.renderBody();
      });
      if (!collapsed) {
        for (const child of node.children) folder.append(this.renderTreeNode(child, depth + 1));
      }
      return folder;
    }

    const row = createEl("button", {
      cls: `git-nav-file-row${this.selectedPath === node.path ? " is-selected" : ""}${
        this.viewedPaths.has(node.path) ? " is-viewed" : ""
      }`,
      attr: { type: "button", title: node.path },
    });
    row.dataset.path = node.path;
    row.style.paddingLeft = `${8 + depth * 12}px`;
    const icon = createSpan("nav-file-icon git-nav-file-icon", row);
    setFileTypeIcon(icon, node.path);
    createSpan({ cls: "git-nav-file-name", text: node.name }, row);
    const stat = createSpan("git-nav-file-stat", row);
    if (node.additions > 0) createEl("ins", { text: `+${node.additions}` }, stat);
    if (node.deletions > 0) createEl("del", { text: `−${node.deletions}` }, stat);
    createSpan(
      {
        cls: `git-nav-file-status mod-${node.status}`,
        text: GIT_STATUS_LABEL[node.status],
        attr: { title: `Git status: ${node.status}`, "aria-label": `Git status: ${node.status}` },
      },
      row,
    );
    row.addEventListener("click", () => {
      this.app.git.reviewSession.activatePath(node.path);
      void this.ensureReviewLeaf();
    });
    return row;
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

  private renderHistoryRow(row: HistoryRow): HTMLButtonElement {
    const selected = historyRowSelected(row, this.source);
    const button = createEl("button", {
      cls: `git-nav-history-entry${row.kind === "commit" ? " with-metadata" : ""}${
        selected ? " is-selected" : ""
      }`,
      attr: { type: "button", title: row.subject },
    });
    createSpan(
      { cls: "git-nav-history-ref", text: row.kind === "working-tree" ? "local" : row.shortHash },
      button,
    );
    if (row.kind === "commit") {
      const lines = createDiv("git-nav-history-lines", button);
      createSpan({ cls: "git-nav-history-subject", text: row.subject }, lines);
      const meta = createSpan("git-nav-history-meta", lines);
      createSpan({ text: row.author }, meta);
      createSpan({ text: "·" }, meta);
      createSpan({ text: formatRelativeDate(row.date) }, meta);
      button.addEventListener("click", () => {
        this.app.git.reviewSession.setSource({
          kind: "commit",
          ref: row.ref,
          subject: row.subject,
        });
        void this.ensureReviewLeaf();
      });
    } else {
      createSpan({ cls: "git-nav-history-subject", text: row.subject }, button);
      button.addEventListener("click", () => {
        this.app.git.reviewSession.setSource({ kind: "working-tree" });
        void this.ensureReviewLeaf();
      });
    }
    return button;
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
    for (const row of this.bodyEl.querySelectorAll(".git-nav-file-row.is-selected")) {
      row.classList.remove("is-selected");
    }
    if (path) {
      const escaped = path.replace(/["\\]/g, "\\$&");
      this.bodyEl.querySelector(`[data-path="${escaped}"]`)?.classList.add("is-selected");
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
