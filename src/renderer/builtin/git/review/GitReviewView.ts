import { parseDiffFromFile } from "@pierre/diffs";
import type { App } from "../../../app/App";
import type { EventRef } from "../../../core/Events";
import { createDiv } from "../../../dom/dom";
import { setIcon } from "../../../ui/Icon";
import { setTooltip } from "../../../ui/Popover";
import { ItemView } from "../../../views/ItemView";
import type { ViewStateResult } from "../../../views/View";
import type { GitNavMode, GitReviewSource } from "../reviewSession";
import { openGitNav } from "./GitNavView";
import { fingerprintContents, statusFromPorcelain, type ReviewFile } from "./reviewModel";
import { toFileSummary } from "./reviewNavModel";
import { ReviewSurface } from "./ReviewSurface";

export type { GitReviewSource } from "../reviewSession";

/** Vanilla center-pane review. The leaf view-header owns both mode switches
 * (Tree/History, Unified/Split) plus Refresh; the right git-nav leaf is a
 * pure list, and the surface renders no internal toolbar. */
export class GitReviewView extends ItemView {
  static readonly VIEW_TYPE = "git-review";

  private source: GitReviewSource = { kind: "working-tree" };
  private sessionRefs: EventRef[] = [];
  private surface: ReviewSurface | null = null;
  private loadRequest = 0;
  private navActionEl: HTMLElement | null = null;
  private layoutActionEl: HTMLElement | null = null;

  getViewType(): string {
    return GitReviewView.VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.source.kind === "commit"
      ? `Review ${this.source.ref.slice(0, 7)}`
      : "Review changes";
  }

  getIcon(): string {
    return "lucide-file-diff";
  }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("git-review-view");
    const session = this.app.git.reviewSession;
    this.source = session.source;
    // Both mode switches are click-to-flip icons in the leaf view-header
    // (Obsidian reading-toggle idiom). Added right-to-left so they land
    // as: Tree/History, Unified/Split, Refresh — left of "More options".
    this.addAction("lucide-rotate-ccw", "Refresh", () => void this.reloadReview());
    this.layoutActionEl = this.addAction("lucide-columns", "Switch to split view", () => {
      this.surface?.toggleDiffStyle();
      this.syncHeaderActions();
    });
    this.navActionEl = this.addAction("lucide-list-tree", "Switch to history", () => {
      session.setMode(session.mode === "tree" ? "history" : "tree");
    });
    this.sessionRefs = [
      session.on<[GitReviewSource]>("source-change", (source) => {
        this.source = source;
        this.leaf.updateHeader();
        void this.reloadReview();
      }),
      session.on<[string, number]>("path-activate", (path) => this.surface?.activatePath(path)),
      session.on<[GitNavMode]>("mode-change", () => this.syncHeaderActions()),
      this.app.workspace.on("css-change", () => this.surface?.refreshTheme()),
    ];
    this.syncHeaderActions();
    await this.reloadReview();
  }

  private syncHeaderActions(): void {
    const mode = this.app.git.reviewSession.mode;
    if (this.navActionEl) {
      setIcon(this.navActionEl, mode === "tree" ? "lucide-list-tree" : "lucide-history");
      setTooltip(this.navActionEl, mode === "tree" ? "Switch to history" : "Switch to tree");
    }
    if (this.layoutActionEl) {
      const split = this.surface?.getDiffStyle() === "split";
      this.layoutActionEl.classList.toggle("is-active", split);
      setTooltip(this.layoutActionEl, split ? "Switch to unified view" : "Switch to split view");
    }
  }

  async setState(state: unknown, result?: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    if (!state || typeof state !== "object" || !(state as { source?: GitReviewSource }).source)
      return;
    this.source = (state as { source: GitReviewSource }).source;
    if (!sameSource(this.app.git.reviewSession.source, this.source)) {
      this.app.git.reviewSession.setSource(this.source);
    }
    this.leaf.updateHeader();
  }

  getState(): Record<string, unknown> {
    return { source: this.source };
  }

  async onClose(): Promise<void> {
    this.loadRequest += 1;
    for (const ref of this.sessionRefs) this.app.git.reviewSession.offref(ref);
    this.sessionRefs = [];
    this.surface?.destroy();
    this.surface = null;
    await super.onClose();
  }

  private async reloadReview(): Promise<void> {
    const request = ++this.loadRequest;
    this.renderMessage("Collecting changes…");
    try {
      if (!this.app.git.isAvailable()) {
        this.block(
          "Git is not available in this runtime. Open the desktop app inside a git repository.",
        );
        return;
      }
      if (!(await this.app.git.isRepository())) {
        if (request === this.loadRequest) this.block("This vault is not a git repository.");
        return;
      }
      const files =
        this.source.kind === "working-tree"
          ? await loadWorkingTree(this.app)
          : await loadCommit(this.app, this.source.ref);
      if (request !== this.loadRequest) return;
      this.app.git.reviewSession.publishFiles(files.map(toFileSummary));
      this.mountSurface(files);
    } catch (error) {
      if (request !== this.loadRequest) return;
      this.block(error instanceof Error ? error.message : String(error));
    }
  }

  private block(message: string): void {
    this.app.git.reviewSession.publishFiles([]);
    this.app.git.reviewSession.selectPath(null);
    this.renderMessage(message);
  }

  private renderMessage(message: string): void {
    this.surface?.destroy();
    this.surface = null;
    this.contentEl.empty();
    createDiv({ cls: "review-empty review-empty-main", text: message }, this.contentEl);
  }

  private mountSurface(files: ReviewFile[]): void {
    this.surface?.destroy();
    this.contentEl.empty();
    const session = this.app.git.reviewSession;
    const selected = session.selectedPath;
    this.surface = new ReviewSurface(this.contentEl, {
      files,
      storageRoot: this.source.kind === "working-tree" ? this.app.git.baseDir() : null,
      title:
        this.source.kind === "commit" ? `Commit ${this.source.ref.slice(0, 7)}` : "Working tree",
      subtitle: this.source.kind === "commit" ? this.source.subject : undefined,
      navMode: session.mode,
      hostControls: true,
      onRefresh: () => void this.reloadReview(),
      showFileSidebar: false,
      onActivePathChange: (path) => session.selectPath(path),
      onViewedPathsChange: (paths) => session.publishViewed(paths),
    });
    if (selected) this.surface.activatePath(selected);
    this.syncHeaderActions();
  }
}

function sameSource(left: GitReviewSource, right: GitReviewSource): boolean {
  return (
    left.kind === right.kind &&
    (left.kind === "working-tree" || left.ref === (right as { ref: string }).ref)
  );
}

/** Open center review + right Tree/History nav (codiff shell, nav on the right). */
export async function openGitReview(
  app: App,
  source: GitReviewSource = { kind: "working-tree" },
  navMode: GitNavMode = "tree",
): Promise<void> {
  app.git.reviewSession.setSource(source);
  app.git.reviewSession.setMode(navMode);
  await app.workspace
    .getLeaf("tab")
    .setViewState({ type: GitReviewView.VIEW_TYPE, active: true, state: { source } });
  await openGitNav(app, true, navMode);
}

/** Bounded-concurrency map: file loads fan out instead of queueing serially. */
const LOAD_POOL = 8;
async function mapPool<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(LOAD_POOL, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
}

async function loadWorkingTree(app: App): Promise<ReviewFile[]> {
  const [status, numstat] = await Promise.all([app.git.status(), app.git.numstat()]);
  const statByPath = new Map(numstat.map((entry) => [entry.path, entry]));
  return mapPool(status, async (entry) => {
    const reviewStatus = statusFromPorcelain(entry.status);
    const [oldContents, newContents] = await Promise.all([
      reviewStatus === "untracked" || reviewStatus === "added"
        ? Promise.resolve("")
        : app.git.readHeadFile(entry.path).then((contents) => contents ?? ""),
      (async () => {
        const workingFile = app.vault.getFileByPath(entry.path);
        return reviewStatus === "deleted" || !workingFile ? "" : await app.vault.read(workingFile);
      })(),
    ]);
    return buildReviewFile(
      entry.path,
      reviewStatus,
      oldContents,
      newContents,
      statByPath.get(entry.path),
    );
  });
}

async function loadCommit(app: App, ref: string): Promise<ReviewFile[]> {
  const [changed, numstat] = await Promise.all([app.git.changedFilesIn(ref), app.git.numstat(ref)]);
  const statByPath = new Map(numstat.map((entry) => [entry.path, entry]));
  return mapPool(changed, async (entry) => {
    const reviewStatus = statusFromPorcelain(entry.status);
    const [oldContents, newContents] = await Promise.all([
      app.git.readFileAt(`${ref}^`, entry.path).then((contents) => contents ?? ""),
      app.git.readFileAt(ref, entry.path).then((contents) => contents ?? ""),
    ]);
    return buildReviewFile(
      entry.path,
      reviewStatus,
      oldContents,
      newContents,
      statByPath.get(entry.path),
    );
  });
}

function buildReviewFile(
  path: string,
  status: ReviewFile["status"],
  oldContents: string,
  newContents: string,
  stat: { additions: number; deletions: number } | undefined,
): ReviewFile {
  const binary = oldContents.includes("\u0000") || newContents.includes("\u0000");
  const safeOld = binary ? "" : oldContents;
  const safeNew = binary ? "" : newContents;
  return {
    path,
    status,
    fileDiff: parseDiffFromFile(
      { name: path, contents: safeOld },
      { name: path, contents: safeNew },
    ),
    additions: stat?.additions ?? (safeNew ? safeNew.split("\n").filter(Boolean).length : 0),
    deletions: stat?.deletions ?? (safeOld ? safeOld.split("\n").filter(Boolean).length : 0),
    fingerprint: fingerprintContents(oldContents, newContents),
    binary,
  };
}
