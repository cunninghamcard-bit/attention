import { Events } from "../../core/Events";

/** Local review target — working tree or a single commit (codiff ReviewSource). */
export type GitReviewSource =
  | { kind: "working-tree" }
  | { kind: "commit"; ref: string; subject?: string };

/** Navigator mode — codiff has walkthrough too; we deliberately omit it. */
export type GitNavMode = "tree" | "history";

export type ReviewFileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";

/** Lightweight file row for the right-nav tree (no FileDiff payload). */
export interface ReviewFileSummary {
  path: string;
  status: ReviewFileStatus;
  additions: number;
  deletions: number;
}

/** Bridges the center git-review leaf and the right git-nav leaf. */
export class GitReviewSession extends Events {
  source: GitReviewSource = { kind: "working-tree" };
  files: ReviewFileSummary[] = [];
  selectedPath: string | null = null;
  viewedPaths = new Set<string>();
  pathActivationSeq = 0;
  mode: GitNavMode = "tree";

  setSource(source: GitReviewSource): void {
    this.source = source;
    this.trigger("source-change", source);
  }

  publishFiles(files: readonly ReviewFileSummary[]): void {
    this.files = [...files];
    this.trigger("files-change", this.files);
    const paths = new Set(this.files.map((file) => file.path));
    if ([...this.viewedPaths].some((path) => !paths.has(path))) {
      this.publishViewed([...this.viewedPaths].filter((path) => paths.has(path)));
    }
  }

  publishViewed(paths: Iterable<string>): void {
    this.viewedPaths = new Set(paths);
    this.trigger("viewed-change", this.viewedPaths);
  }

  /** Updates selection without requesting a scroll (for the center scroll spy). */
  selectPath(path: string | null): void {
    if (this.selectedPath === path) return;
    this.selectedPath = path;
    this.trigger("path-change", path);
  }

  /** Requests a scroll even when the path is already selected, matching codiff. */
  activatePath(path: string): void {
    this.selectPath(path);
    this.pathActivationSeq += 1;
    this.trigger("path-activate", path, this.pathActivationSeq);
  }

  setMode(mode: GitNavMode): void {
    this.mode = mode;
    this.trigger("mode-change", mode);
  }
}
