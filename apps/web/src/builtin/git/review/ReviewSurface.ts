import {
  CodeView,
  type CodeViewItem,
  type CodeViewOptions,
  type DiffLineAnnotation,
} from "@pierre/diffs";
import { getOrCreateWorkerPoolSingleton, type WorkerPoolManager } from "@pierre/diffs/worker";
import { createDiv, createEl, createSpan } from "../../../dom/dom";
import { setIcon } from "../../../ui/Icon";
import { Notice } from "../../../ui/Notice";
import { renderCheck } from "./checkControl";
import {
  isViewed,
  readDiffStyle,
  readViewed,
  type ReviewDiffStyle,
  type ReviewDraftComment,
  type ReviewFile,
  type ReviewFileStatus,
  statusLetter,
  writeDiffStyle,
  writeViewed,
} from "./reviewModel";

interface CommentAnnotationMetadata {
  draftId: string;
}

export interface ReviewSubmitOptions {
  onSubmit(
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
    body: string,
    comments: ReviewDraftComment[],
  ): Promise<string | null>;
}

export interface ReviewSurfaceProps {
  files: ReviewFile[];
  storageRoot: string | null;
  title: string;
  subtitle?: string;
  /** PR review only: enables inline comment drafts and the submit bar. The
   * local review is view-only, so it omits this. */
  review?: ReviewSubmitOptions;
  /** Local review only: current nav mode, for a host-driven header toggle. */
  navMode?: "tree" | "history";
  /** When true, the host (the leaf) owns the controls in its view-header, so
   * the surface renders no internal toolbar. The PR tab embeds the surface in
   * a sub-tab with no header of its own, so it omits this and keeps the bar. */
  hostControls?: boolean;
  onRefresh?(): void;
  showFileSidebar?: boolean;
  onActivePathChange?(path: string | null): void;
  onViewedPathsChange?(paths: ReadonlySet<string>): void;
}

const ACTIVATION_PADDING = 11;
const PROGRAMMATIC_SCROLL_TIMEOUT = 1200;

/** Shiki highlighting runs in pierre's worker pool (codiff's recipe: 3
 * workers, same limits) so big diffs never block the main thread. Absent in
 * jsdom, where Worker does not exist. */
function highlightWorkers(): WorkerPoolManager | undefined {
  if (typeof Worker === "undefined") return undefined;
  return getOrCreateWorkerPoolSingleton({
    poolOptions: {
      poolSize: Math.min(3, Math.max(1, navigator.hardwareConcurrency || 3)),
      workerFactory: () =>
        new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), {
          type: "module",
        }),
    },
    highlighterOptions: { maxLineDiffLength: 2000, tokenizeMaxLineLength: 20_000 },
  });
}

/** Vanilla owner of the shared multi-file pierre CodeView. */
export class ReviewSurface {
  private props: ReviewSurfaceProps;
  private readonly rootEl: HTMLDivElement;
  private readonly sidebarEl: HTMLDivElement;
  private readonly toolbarEl: HTMLDivElement;
  private readonly codeHostEl: HTMLDivElement;
  private readonly codeRootEl: HTMLDivElement;
  private readonly footerEl: HTMLDivElement;
  private readonly codeView: CodeView<CommentAnnotationMetadata>;
  private unsubscribeScroll: (() => void) | null = null;
  private viewed: Record<string, string>;
  private collapsed = new Set<string>();
  private drafts: ReviewDraftComment[] = [];
  private activePath: string | null = null;
  private filter = "";
  private diffStyle: ReviewDiffStyle = readDiffStyle();
  private reviewBody = "";
  private busy = false;
  private draftSeq = 0;
  private programmaticPath: string | null = null;
  private programmaticTimer: number | null = null;
  private headerEls = new Map<string, HTMLElement>();
  private rowEls = new Map<string, HTMLElement>();

  constructor(container: HTMLElement, props: ReviewSurfaceProps) {
    this.props = props;
    this.viewed = props.storageRoot ? readViewed(props.storageRoot) : {};
    this.rootEl = createDiv("review-surface", container);
    this.sidebarEl = createDiv("review-sidebar", this.rootEl);
    const main = createDiv("review-main", this.rootEl);
    this.toolbarEl = createDiv("review-toolbar", main);
    this.codeHostEl = createDiv("review-codeview-host", main);
    this.codeRootEl = createDiv("review-codeview", this.codeHostEl);
    this.footerEl = createDiv(undefined, main);
    this.codeView = new CodeView(this.codeViewOptions(), highlightWorkers());
    this.codeView.setup(this.codeRootEl);
    this.unsubscribeScroll = this.codeView.subscribeToScroll((_scrollTop, viewer) => {
      this.updateActivePathFromScroll(viewer);
    });
    this.rootEl.tabIndex = 0;
    this.rootEl.addEventListener("keydown", (event) => this.onKeyDown(event));
    this.update(props);
  }

  update(props: ReviewSurfaceProps): void {
    const rootChanged = this.props.storageRoot !== props.storageRoot;
    this.props = props;
    if (rootChanged) this.viewed = props.storageRoot ? readViewed(props.storageRoot) : {};
    const paths = new Set(props.files.map((file) => file.path));
    this.collapsed = new Set([...this.collapsed].filter((path) => paths.has(path)));
    this.drafts = this.drafts.filter((draft) => paths.has(draft.path));
    if (!this.activePath || !paths.has(this.activePath)) {
      this.activePath = props.files[0]?.path ?? null;
    }
    this.rootEl.classList.toggle("is-nav-external", props.showFileSidebar === false);
    this.sidebarEl.hidden = props.showFileSidebar === false;
    this.render();
    this.publishViewed();
    props.onActivePathChange?.(this.activePath);
  }

  /** A nav activation is an event, so repeating the current path scrolls again. */
  activatePath(path: string): void {
    if (!this.props.files.some((file) => file.path === path)) return;
    this.activePath = path;
    this.props.onActivePathChange?.(path);
    this.programmaticPath = path;
    if (this.programmaticTimer !== null) window.clearTimeout(this.programmaticTimer);
    this.programmaticTimer = window.setTimeout(() => {
      this.programmaticPath = null;
      this.programmaticTimer = null;
    }, PROGRAMMATIC_SCROLL_TIMEOUT);
    this.codeView.scrollTo({ type: "item", id: path, align: "start", behavior: "smooth" });
    this.applyActivePath();
  }

  /** Active-path sync is imperative class-toggling — a full CodeView
   * re-render per scroll tick is exactly the jank this avoids. */
  private applyActivePath(): void {
    for (const [path, header] of this.headerEls) {
      header.classList.toggle("is-active", path === this.activePath);
    }
    for (const [path, row] of this.rowEls) {
      row.classList.toggle("is-active", path === this.activePath);
    }
  }

  destroy(): void {
    if (this.programmaticTimer !== null) window.clearTimeout(this.programmaticTimer);
    this.unsubscribeScroll?.();
    this.unsubscribeScroll = null;
    this.codeView.cleanUp();
    this.rootEl.remove();
  }

  private visibleFiles(): ReviewFile[] {
    const query = this.filter.trim().toLowerCase();
    return query
      ? this.props.files.filter((file) => file.path.toLowerCase().includes(query))
      : this.props.files;
  }

  private render(): void {
    this.renderSidebar();
    this.renderToolbar();
    this.renderCodeView();
    this.renderFooter();
  }

  private renderSidebar(): void {
    if (this.props.showFileSidebar === false) return;
    this.rowEls.clear();
    this.sidebarEl.empty();
    createDiv({ cls: "review-sidebar-title", text: this.props.title }, this.sidebarEl);
    if (this.props.subtitle) {
      createDiv({ cls: "review-sidebar-subtitle", text: this.props.subtitle }, this.sidebarEl);
    }
    const filter = createEl(
      "input",
      { cls: "review-filter", attr: { type: "search" }, placeholder: "Filter files" },
      this.sidebarEl,
    );
    filter.value = this.filter;
    filter.addEventListener("input", () => {
      this.filter = filter.value;
      this.renderSidebar();
      this.renderCodeView();
    });
    const viewedCount = this.viewedCount();
    const progress = createDiv(
      {
        cls: "review-progress",
        attr: { "aria-label": `${viewedCount} of ${this.props.files.length} files viewed` },
      },
      this.sidebarEl,
    );
    const track = createDiv("review-progress-track", progress);
    const fill = createDiv("review-progress-fill", track);
    fill.style.width = this.props.files.length
      ? `${(viewedCount / this.props.files.length) * 100}%`
      : "0%";
    createSpan(
      { cls: "review-progress-text", text: `${viewedCount} / ${this.props.files.length} viewed` },
      progress,
    );
    const list = createDiv("review-file-list", this.sidebarEl);
    for (const file of this.visibleFiles()) {
      const row = createEl(
        "button",
        {
          cls: `review-file-row tappable${this.activePath === file.path ? " is-active" : ""}${isViewed(this.viewed, file) ? " is-viewed" : ""}`,
          attr: { type: "button", title: file.path },
        },
        list,
      );
      this.rowEls.set(file.path, row);
      createSpan(`review-status-dot mod-${file.status}`, row);
      createSpan({ cls: "review-file-row-name", text: file.path }, row);
      const stat = createSpan("review-file-row-stat", row);
      if (file.additions > 0) createEl("ins", { text: `+${file.additions}` }, stat);
      if (file.deletions > 0) createEl("del", { text: `−${file.deletions}` }, stat);
      row.addEventListener("click", () => this.activatePath(file.path));
    }
    if (this.visibleFiles().length === 0)
      createDiv({ cls: "review-empty", text: "No files match." }, list);
  }

  getDiffStyle(): ReviewDiffStyle {
    return this.diffStyle;
  }

  /** Flip unified ⟷ split. Driven by the leaf view-header for the local
   * review, or by the surface's own toolbar for the PR tab. */
  toggleDiffStyle(): void {
    this.diffStyle = this.diffStyle === "split" ? "unified" : "split";
    writeDiffStyle(this.diffStyle);
    if (!this.props.hostControls) this.renderToolbar();
    this.codeView.setOptions(this.codeViewOptions());
    this.codeView.render(true);
  }

  private renderToolbar(): void {
    // Local review: the leaf owns the controls in its view-header, so no bar.
    if (this.props.hostControls) {
      this.toolbarEl.hidden = true;
      return;
    }
    this.toolbarEl.empty();
    const controls = createDiv("review-toolbar-controls", this.toolbarEl);
    const isSplit = this.diffStyle === "split";
    const layout = createEl(
      "button",
      {
        cls: `clickable-icon review-toolbar-toggle${isSplit ? " is-active" : ""}`,
        attr: {
          type: "button",
          "aria-label": isSplit ? "Switch to unified view" : "Switch to split view",
        },
      },
      controls,
    );
    setIcon(layout, "lucide-columns");
    layout.addEventListener("click", () => this.toggleDiffStyle());

    const actions = createDiv("review-toolbar-actions", this.toolbarEl);
    if (this.props.onRefresh) {
      const refresh = createEl(
        "button",
        { cls: "clickable-icon", attr: { type: "button", "aria-label": "Refresh" } },
        actions,
      );
      setIcon(refresh, "lucide-rotate-ccw");
      refresh.addEventListener("click", () => this.props.onRefresh?.());
    }
  }

  private renderCodeView(): void {
    this.headerEls.clear();
    if (this.props.files.length === 0) {
      this.codeRootEl.hidden = true;
      let empty = this.codeHostEl.querySelector<HTMLElement>(".review-empty-main");
      if (!empty) empty = createDiv("review-empty review-empty-main", this.codeHostEl);
      empty.textContent = "Nothing to review — the working tree is clean.";
      return;
    }
    this.codeHostEl.querySelector(".review-empty-main")?.remove();
    this.codeRootEl.hidden = false;
    this.codeView.setOptions(this.codeViewOptions());
    this.codeView.setItems(this.codeViewItems());
    this.codeView.render(true);
  }

  private codeViewOptions(): CodeViewOptions<CommentAnnotationMetadata> {
    return {
      collapsedContextThreshold: 12,
      diffIndicators: "bars",
      diffStyle: this.diffStyle,
      // Inline comments are a PR-review feature; the local review is view-only.
      enableGutterUtility: this.props.review != null,
      expandUnchanged: false,
      expansionLineCount: 100,
      hunkSeparators: "line-info-basic",
      itemMetrics: { diffHeaderHeight: 44 },
      layout: { gap: 12, paddingTop: 10, paddingBottom: 10 },
      lineHoverHighlight: "both",
      stickyHeaders: true,
      themeType: document.body.classList.contains("theme-dark") ? "dark" : "light",
      renderCustomHeader: (_fileDiff, context) => this.renderHeader(context.item.id),
      renderGutterUtility: this.props.review
        ? (getHoveredLine, context) => {
            const button = createEl("button", {
              cls: "review-add-comment",
              text: "+",
              attr: { type: "button", "aria-label": "Add review comment" },
            });
            button.addEventListener("mousedown", (event) => {
              event.preventDefault();
              const line = getHoveredLine();
              if (!line) return;
              this.draftSeq += 1;
              this.drafts.push({
                id: `draft-${this.draftSeq}`,
                path: context.item.id,
                side: "side" in line && line.side ? line.side : "additions",
                line: line.lineNumber,
                body: "",
              });
              this.render();
            });
            return button;
          }
        : undefined,
      renderAnnotation: (annotation) => this.renderAnnotation(annotation),
    };
  }

  private codeViewItems(): CodeViewItem<CommentAnnotationMetadata>[] {
    return this.visibleFiles().map((file) => {
      const fileDrafts = this.drafts.filter((draft) => draft.path === file.path);
      const collapsed = this.collapsed.has(file.path);
      return {
        id: file.path,
        type: "diff",
        fileDiff: file.fileDiff,
        collapsed,
        version: hashVersion(
          `${file.fingerprint}:${collapsed ? 1 : 0}:${fileDrafts.map((draft) => `${draft.id}:${draft.body}`).join(",")}`,
        ),
        annotations: fileDrafts.map((draft) => ({
          side: draft.side,
          lineNumber: draft.line,
          metadata: { draftId: draft.id },
        })),
      };
    });
  }

  private renderHeader(path: string): HTMLElement | null {
    const file = this.props.files.find((candidate) => candidate.path === path);
    if (!file) return null;
    const header = createDiv(`review-card-header${this.activePath === path ? " is-active" : ""}`);
    this.headerEls.set(path, header);
    const chevron = createSpan(
      `review-chevron${this.collapsed.has(path) ? " is-collapsed" : ""}`,
      header,
    );
    setIcon(chevron, "lucide-chevron-down");
    const pathEl = createSpan({ cls: "review-card-path", attr: { title: path } }, header);
    const slash = path.lastIndexOf("/");
    if (slash >= 0) createSpan({ cls: "review-card-dir", text: path.slice(0, slash + 1) }, pathEl);
    createSpan({ cls: "review-card-name", text: path.slice(slash + 1) }, pathEl);
    const stat = createSpan("review-card-stat", header);
    if (file.binary) createSpan({ cls: "review-card-binary", text: "binary" }, stat);
    else {
      if (file.additions > 0) createEl("ins", { text: `+${file.additions}` }, stat);
      if (file.deletions > 0) createEl("del", { text: `−${file.deletions}` }, stat);
    }
    createSpan(
      { cls: `review-card-status mod-${file.status}`, text: statusLetter(file.status) },
      header,
    );
    const actionsEl = createDiv("review-card-actions", header);
    const viewed = createEl(
      "button",
      {
        cls: "review-viewed",
        attr: { type: "button", "aria-pressed": String(isViewed(this.viewed, file)) },
      },
      actionsEl,
    );
    renderCheck(isViewed(this.viewed, file) ? "on" : "off", viewed);
    createSpan({ text: "Viewed" }, viewed);
    viewed.addEventListener("click", (event) => {
      event.stopPropagation();
      this.markViewed(file, !isViewed(this.viewed, file));
    });
    header.addEventListener("click", () => {
      if (this.collapsed.has(path)) this.collapsed.delete(path);
      else this.collapsed.add(path);
      this.render();
    });
    return header;
  }

  private renderAnnotation(
    annotation: DiffLineAnnotation<CommentAnnotationMetadata>,
  ): HTMLElement | undefined {
    const draft = this.drafts.find((candidate) => candidate.id === annotation.metadata?.draftId);
    if (!draft) return undefined;
    const thread = createDiv("review-comment-thread");
    if (draft.body) {
      createDiv({ cls: "review-comment-body", text: draft.body }, thread);
      const actions = createDiv("review-comment-actions", thread);
      this.draftButton(actions, "Edit", () => {
        draft.body = "";
        this.render();
      });
      this.draftButton(actions, "Delete", () => {
        this.drafts = this.drafts.filter((candidate) => candidate.id !== draft.id);
        this.render();
      });
      return thread;
    }
    const input = createEl(
      "textarea",
      { cls: "review-comment-input", placeholder: "Leave a review comment", attr: { rows: 3 } },
      thread,
    );
    const actions = createDiv("review-comment-actions", thread);
    const save = this.draftButton(actions, "Save", () => {
      draft.body = input.value.trim();
      this.render();
    });
    save.disabled = true;
    input.addEventListener("input", () => (save.disabled = input.value.trim().length === 0));
    this.draftButton(actions, "Cancel", () => {
      this.drafts = this.drafts.filter((candidate) => candidate.id !== draft.id);
      this.render();
    });
    queueMicrotask(() => input.focus());
    return thread;
  }

  private draftButton(parent: HTMLElement, label: string, action: () => void): HTMLButtonElement {
    const button = createEl(
      "button",
      { cls: "review-card-action", text: label, attr: { type: "button" } },
      parent,
    );
    button.addEventListener("click", action);
    return button;
  }

  private renderFooter(): void {
    this.footerEl.empty();
    if (!this.props.review) return;
    this.footerEl.className = "review-submit-bar";
    const draftCount = this.completedDrafts().length;
    const body = createEl(
      "textarea",
      {
        cls: "review-submit-body",
        placeholder: draftCount
          ? `Review summary (submits ${draftCount} inline comment${draftCount === 1 ? "" : "s"})`
          : "Review summary",
        attr: { rows: 2 },
      },
      this.footerEl,
    );
    body.value = this.reviewBody;
    body.addEventListener("input", () => {
      this.reviewBody = body.value;
      this.renderFooter();
    });
    const actions = createDiv("review-submit-actions", this.footerEl);
    for (const [label, event] of [
      ["Comment", "COMMENT"],
      ["Approve", "APPROVE"],
      ["Request changes", "REQUEST_CHANGES"],
    ] as const) {
      const button = createEl(
        "button",
        {
          cls: `review-action${event === "APPROVE" ? " mod-approve" : event === "REQUEST_CHANGES" ? " mod-request-changes" : ""}`,
          text: label,
          attr: { type: "button" },
        },
        actions,
      );
      button.disabled =
        this.busy || (event === "COMMENT" && draftCount === 0 && !this.reviewBody.trim());
      button.addEventListener("click", () => void this.submitReview(event));
    }
  }

  private markViewed(file: ReviewFile, nextViewed: boolean): void {
    if (nextViewed) {
      this.viewed[file.path] = file.fingerprint;
      this.collapsed.add(file.path);
    } else {
      delete this.viewed[file.path];
      this.collapsed.delete(file.path);
    }
    if (this.props.storageRoot) writeViewed(this.props.storageRoot, this.viewed);
    this.publishViewed();
    this.render();
  }

  private publishViewed(): void {
    this.props.onViewedPathsChange?.(
      new Set(
        this.props.files.filter((file) => isViewed(this.viewed, file)).map((file) => file.path),
      ),
    );
  }

  private viewedCount(): number {
    return this.props.files.filter((file) => isViewed(this.viewed, file)).length;
  }

  private completedDrafts(): ReviewDraftComment[] {
    return this.drafts.filter((draft) => draft.body.trim().length > 0);
  }

  private updateActivePathFromScroll(viewer: CodeView<CommentAnnotationMetadata>): void {
    const files = this.visibleFiles();
    if (files.length === 0) return;
    const activationTop = viewer.getScrollTop() + ACTIVATION_PADDING;
    let nextPath = files[0]?.path ?? null;
    let nextDistance = Number.NEGATIVE_INFINITY;
    for (const file of files) {
      const top = viewer.getTopForItem(file.path);
      if (top == null) continue;
      const distance = top - activationTop;
      if (distance <= 0 && distance > nextDistance) {
        nextDistance = distance;
        nextPath = file.path;
      }
    }
    if (this.programmaticPath && nextPath !== this.programmaticPath) return;
    if (this.programmaticPath) {
      this.programmaticPath = null;
      if (this.programmaticTimer !== null) window.clearTimeout(this.programmaticTimer);
      this.programmaticTimer = null;
    }
    if (nextPath && nextPath !== this.activePath) {
      this.activePath = nextPath;
      this.props.onActivePathChange?.(nextPath);
      this.applyActivePath();
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("input, textarea, [contenteditable]")
    )
      return;
    const files = this.visibleFiles();
    const index = this.activePath ? files.findIndex((file) => file.path === this.activePath) : -1;
    const active = files[index];
    if (event.key === "j" && files.length)
      this.activatePath(files[Math.min(index + 1, files.length - 1)].path);
    else if (event.key === "k" && files.length)
      this.activatePath(files[Math.max(index, 0) - (index > 0 ? 1 : 0)].path);
    else if (event.key === "v" && active) this.markViewed(active, !isViewed(this.viewed, active));
    else if (event.key === "x" && active) {
      if (this.collapsed.has(active.path)) this.collapsed.delete(active.path);
      else this.collapsed.add(active.path);
      this.render();
    } else if (event.key === "s") {
      this.diffStyle = this.diffStyle === "split" ? "unified" : "split";
      writeDiffStyle(this.diffStyle);
      this.render();
    } else return;
    event.preventDefault();
  }

  private async submitReview(event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"): Promise<void> {
    if (!this.props.review) return;
    this.busy = true;
    this.renderFooter();
    try {
      const error = await this.props.review.onSubmit(
        event,
        this.reviewBody.trim(),
        this.completedDrafts(),
      );
      if (error) return void new Notice(`Review failed: ${error}`);
      this.drafts = [];
      this.reviewBody = "";
      this.props.onRefresh?.();
      this.render();
    } finally {
      this.busy = false;
      this.renderFooter();
    }
  }
}

function hashVersion(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++)
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  return hash;
}
