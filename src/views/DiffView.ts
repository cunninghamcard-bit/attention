import { Compartment, type Extension } from "@codemirror/state";
import { acceptChunk, getChunks, goToNextChunk, goToPreviousChunk, rejectChunk, unifiedMergeView } from "@codemirror/merge";
import type { App } from "../app/App";
import type { TFile } from "../vault/TAbstractFile";
import type { ViewStateResult } from "./View";
import type { WorkspaceLeaf } from "../workspace/WorkspaceLeaf";
import { CodeFileView } from "./CodeFileView";

/**
 * Unified diff/review view (@codemirror/merge): the editor shows the file's
 * current content against a provided `original`, with per-chunk accept/reject
 * controls. Accepted/rejected content flows through CodeFileView's normal
 * save pipeline, so reviewing an agent's edit and persisting the verdict is
 * one motion. Comparing two files is the same view with `original` set to the
 * other file's text.
 */
export class DiffView extends CodeFileView {
  static readonly DIFF_VIEW_TYPE = "diff";
  private readonly mergeCompartment = new Compartment();
  private original: string | null = null;

  getViewType(): string { return DiffView.DIFF_VIEW_TYPE; }
  getDisplayText(): string { return this.file ? `${this.file.name} (changes)` : "Diff"; }
  getIcon(): string { return "lucide-file-diff"; }

  protected override baseExtensions(): Extension[] {
    return [...super.baseExtensions(), this.mergeCompartment.of([])];
  }

  override async setState(state: unknown, result?: ViewStateResult): Promise<void> {
    if (state && typeof state === "object" && typeof (state as { original?: unknown }).original === "string") {
      this.original = (state as { original: string }).original;
    }
    await super.setState(state, result);
    this.applyOriginal();
  }

  override getState(): Record<string, unknown> {
    return { ...super.getState(), original: this.original };
  }

  /** Number of unresolved changed chunks. */
  getChunkCount(): number {
    if (!this.cm) return 0;
    return getChunks(this.cm.state)?.chunks.length ?? 0;
  }

  acceptAll(): void {
    while (this.cm && (getChunks(this.cm.state)?.chunks.length ?? 0) > 0) {
      if (!acceptChunk(this.cm, getChunks(this.cm.state)!.chunks[0].fromB)) break;
    }
  }

  rejectAll(): void {
    while (this.cm && (getChunks(this.cm.state)?.chunks.length ?? 0) > 0) {
      if (!rejectChunk(this.cm, getChunks(this.cm.state)!.chunks[0].fromB)) break;
    }
  }

  nextChunk(): void {
    if (this.cm) goToNextChunk(this.cm);
  }

  previousChunk(): void {
    if (this.cm) goToPreviousChunk(this.cm);
  }

  private applyOriginal(): void {
    if (!this.cm) return;
    this.cm.dispatch({
      effects: this.mergeCompartment.reconfigure(this.original === null ? [] : unifiedMergeView({
        original: this.original,
        collapseUnchanged: { margin: 3, minSize: 6 },
        allowInlineDiffs: true,
      })),
    });
  }
}

/** Opens the review view for `file`, diffing its current content against `original`. */
export async function openFileDiff(app: App, file: TFile, original: string, options: { active?: boolean } = {}): Promise<WorkspaceLeaf> {
  const leaf = app.workspace.getLeaf("tab");
  await leaf.setViewState({
    type: DiffView.DIFF_VIEW_TYPE,
    active: options.active ?? true,
    state: { file: file.path, original },
  });
  return leaf;
}

/** Opens a comparison of two files: `file` stays editable, `against` is the baseline. */
export async function openFileCompare(app: App, file: TFile, against: TFile): Promise<WorkspaceLeaf> {
  const original = await app.vault.read(against);
  return openFileDiff(app, file, original);
}

/**
 * Opens the git diff for `file`: current content against HEAD. Untracked
 * files diff against empty (everything reads as added). Returns null when
 * git is unavailable or the vault is not a repository.
 */
export async function openGitDiff(app: App, file: TFile): Promise<WorkspaceLeaf | null> {
  if (!app.git.isAvailable() || !(await app.git.isRepository())) return null;
  const original = await app.git.readHeadFile(file.path);
  return openFileDiff(app, file, original ?? "");
}
