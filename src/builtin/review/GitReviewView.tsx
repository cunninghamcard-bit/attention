import { type ReactNode, useCallback, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseDiffFromFile } from "@pierre/diffs";
import { ItemView } from "../../views/ItemView";
import type { ViewStateResult } from "../../views/View";
import type { App } from "../../app/App";
import { openGitDiff } from "../../views/DiffView";
import { Notice } from "../../ui/Notice";
import { fingerprintContents, statusFromPorcelain, type ReviewFile } from "./reviewModel";
import { ReviewSurface } from "./ReviewSurface";

/**
 * Full-window review of a change set — the working tree (with a file-granular
 * commit composer) or a single commit. The same surface also backs the PR
 * "Files changed" tab; this view owns the two local git sources.
 */

export type GitReviewSource =
  | { kind: "working-tree" }
  | { kind: "commit"; ref: string; subject?: string };

export class GitReviewView extends ItemView {
  static readonly VIEW_TYPE = "git-review";
  private root: Root | null = null;
  private source: GitReviewSource = { kind: "working-tree" };

  getViewType(): string { return GitReviewView.VIEW_TYPE; }
  getDisplayText(): string {
    return this.source.kind === "commit" ? `Review ${this.source.ref.slice(0, 7)}` : "Review changes";
  }
  getIcon(): string { return "lucide-file-diff"; }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("git-review-view");
    this.root = createRoot(this.contentEl);
    this.render();
  }

  async setState(state: unknown, result?: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    if (state && typeof state === "object" && (state as { source?: GitReviewSource }).source) {
      this.source = (state as { source: GitReviewSource }).source;
      this.render();
      this.leaf.updateHeader();
    }
  }

  getState(): Record<string, unknown> {
    return { source: this.source };
  }

  private render(): void {
    this.root?.render(<GitReviewPanel app={this.app} source={this.source} />);
  }

  async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
    await super.onClose();
  }
}

export async function openGitReview(app: App, source: GitReviewSource = { kind: "working-tree" }): Promise<void> {
  await app.workspace.getLeaf("tab").setViewState({ type: GitReviewView.VIEW_TYPE, active: true, state: { source } });
}

function GitReviewPanel({ app, source }: { app: App; source: GitReviewSource }): ReactNode {
  const [files, setFiles] = useState<ReviewFile[] | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  const load = useCallback(async () => {
    setFiles(null);
    setBlocked(null);
    if (!app.git.isAvailable()) {
      setBlocked("Git is not available in this runtime. Open the desktop app inside a git repository.");
      return;
    }
    if (!(await app.git.isRepository())) {
      setBlocked("This vault is not a git repository.");
      return;
    }
    setFiles(source.kind === "working-tree" ? await loadWorkingTree(app) : await loadCommit(app, source.ref));
  }, [app, source]);

  useEffect(() => {
    void load();
  }, [load, generation]);

  const refresh = useCallback(() => setGeneration((current) => current + 1), []);

  const commitSelected = useCallback(async (paths: string[], subject: string, body: string) => {
    // File-granular commit: rebuild the index to exactly the selection.
    const reset = await app.git.unstageAll();
    if (!reset) return "could not reset the index";
    if (!(await app.git.stage(paths))) return "could not stage the selected files";
    return app.git.commit(body ? `${subject}\n\n${body}` : subject);
  }, [app]);

  const openFile = useCallback((path: string) => {
    const file = app.vault.getFileByPath(path);
    if (!file) {
      new Notice("File not found in the vault");
      return;
    }
    void app.workspace.getLeaf("tab").openFile(file);
  }, [app]);

  const editDiff = useCallback((path: string) => {
    const file = app.vault.getFileByPath(path);
    if (!file) {
      new Notice("File not found in the vault");
      return;
    }
    void openGitDiff(app, file);
  }, [app]);

  if (blocked) return <div className="review-empty review-empty-main">{blocked}</div>;
  if (files === null) return <div className="review-empty review-empty-main">Collecting changes…</div>;

  return (
    <ReviewSurface
      files={files}
      storageRoot={source.kind === "working-tree" ? app.git.baseDir() : null}
      title={source.kind === "commit" ? `Commit ${source.ref.slice(0, 7)}` : "Working tree"}
      subtitle={source.kind === "commit" ? source.subject : undefined}
      commit={source.kind === "working-tree" ? { onCommit: commitSelected } : undefined}
      onOpenFile={source.kind === "working-tree" ? openFile : undefined}
      onEditDiff={source.kind === "working-tree" ? editDiff : undefined}
      onRefresh={refresh}
    />
  );
}

async function loadWorkingTree(app: App): Promise<ReviewFile[]> {
  const [status, numstat] = await Promise.all([app.git.status(), app.git.numstat()]);
  const statByPath = new Map(numstat.map((entry) => [entry.path, entry]));
  const files: ReviewFile[] = [];
  for (const entry of status) {
    const reviewStatus = statusFromPorcelain(entry.status);
    const oldContents = reviewStatus === "untracked" || reviewStatus === "added"
      ? ""
      : (await app.git.readHeadFile(entry.path)) ?? "";
    const workingFile = app.vault.getFileByPath(entry.path);
    const newContents = reviewStatus === "deleted" || !workingFile ? "" : await app.vault.read(workingFile);
    files.push(buildReviewFile(entry.path, reviewStatus, oldContents, newContents, statByPath.get(entry.path)));
  }
  return files;
}

async function loadCommit(app: App, ref: string): Promise<ReviewFile[]> {
  const [changed, numstat] = await Promise.all([app.git.changedFilesIn(ref), app.git.numstat(ref)]);
  const statByPath = new Map(numstat.map((entry) => [entry.path, entry]));
  const files: ReviewFile[] = [];
  for (const entry of changed) {
    const reviewStatus = statusFromPorcelain(entry.status);
    const oldContents = (await app.git.readFileAt(`${ref}^`, entry.path)) ?? "";
    const newContents = (await app.git.readFileAt(ref, entry.path)) ?? "";
    files.push(buildReviewFile(entry.path, reviewStatus, oldContents, newContents, statByPath.get(entry.path)));
  }
  return files;
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
    fileDiff: parseDiffFromFile({ name: path, contents: safeOld }, { name: path, contents: safeNew }),
    additions: stat?.additions ?? (safeNew ? safeNew.split("\n").filter(Boolean).length : 0),
    deletions: stat?.deletions ?? (safeOld ? safeOld.split("\n").filter(Boolean).length : 0),
    fingerprint: fingerprintContents(oldContents, newContents),
    binary,
  };
}
