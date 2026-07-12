import { Events } from "../core/Events";
import type { WorkspaceLeaf } from "./WorkspaceLeaf";
import type { View } from "../views/View";
import { MarkdownView } from "../views/MarkdownView";
import { CODE_EXTENSIONS, CodeFileView } from "../views/CodeFileView";
import { DiffView } from "../views/DiffView";
import { GitChangesView } from "../builtin/GitChangesView";
import { GitHistoryView } from "../builtin/GitHistoryView";
import { PrDetailView, PrListView } from "../builtin/GitPrViews";
import { GitCommitView, GitHubWorkspaceView } from "../builtin/GitHubWorkspace";
import { GitReviewView } from "../builtin/review/GitReviewView";
import {
  AUDIO_EXTENSIONS,
  AudioView,
  IMAGE_EXTENSIONS,
  ImageView,
  PDF_EXTENSIONS,
  PdfView,
  ReleaseNotesView,
  VIDEO_EXTENSIONS,
  VideoView,
} from "../views/MediaViews";

export type ViewCreator = (leaf: WorkspaceLeaf) => View;

export class ViewRegistry extends Events {
  private viewByType = new Map<string, ViewCreator>();
  private typeByExtension = new Map<string, string>();

  constructor() {
    super();
    this.registerViewWithExtensions(["md"], MarkdownView.VIEW_TYPE, (leaf) => new MarkdownView(leaf));
    this.registerViewWithExtensions(IMAGE_EXTENSIONS, ImageView.VIEW_TYPE, (leaf) => new ImageView(leaf));
    this.registerViewWithExtensions(AUDIO_EXTENSIONS, AudioView.VIEW_TYPE, (leaf) => new AudioView(leaf));
    this.registerViewWithExtensions(VIDEO_EXTENSIONS, VideoView.VIEW_TYPE, (leaf) => new VideoView(leaf));
    this.registerViewWithExtensions(PDF_EXTENSIONS, PdfView.VIEW_TYPE, (leaf) => new PdfView(leaf));
    this.registerViewWithExtensions(CODE_EXTENSIONS, CodeFileView.VIEW_TYPE, (leaf) => new CodeFileView(leaf));
    this.registerView(DiffView.DIFF_VIEW_TYPE, (leaf) => new DiffView(leaf));
    this.registerView(GitChangesView.VIEW_TYPE, (leaf) => new GitChangesView(leaf));
    this.registerView(GitHistoryView.VIEW_TYPE, (leaf) => new GitHistoryView(leaf));
    this.registerView(PrListView.VIEW_TYPE, (leaf) => new PrListView(leaf));
    this.registerView(PrDetailView.VIEW_TYPE, (leaf) => new PrDetailView(leaf));
    this.registerView(GitHubWorkspaceView.VIEW_TYPE, (leaf) => new GitHubWorkspaceView(leaf));
    this.registerView(GitCommitView.VIEW_TYPE, (leaf) => new GitCommitView(leaf));
    this.registerView(GitReviewView.VIEW_TYPE, (leaf) => new GitReviewView(leaf));
    this.registerView(ReleaseNotesView.VIEW_TYPE, (leaf) => new ReleaseNotesView(leaf));
  }

  registerView(type: string, creator: ViewCreator): void {
    if (this.viewByType.has(type)) throw new Error(`Attempting to register an existing view type "${type}"`);
    this.viewByType.set(type, creator);
    this.trigger("view-registered", type);
  }

  unregisterView(type: string): void {
    if (!this.viewByType.has(type)) return;
    this.viewByType.delete(type);
    this.trigger("view-unregistered", type);
  }

  registerExtensions(extensions: string[], viewType: string): void {
    for (const extension of extensions) {
      if (this.typeByExtension.has(extension)) throw new Error(`Attempting to register an existing file extension "${extension}"`);
    }
    for (const extension of extensions) this.typeByExtension.set(extension, viewType);
    this.trigger("extensions-updated");
  }

  unregisterExtensions(extensions: string[]): void {
    for (const extension of extensions) this.typeByExtension.delete(extension);
    this.trigger("extensions-updated");
  }

  registerViewWithExtensions(extensions: string[], type: string, creator: ViewCreator): void {
    this.registerView(type, creator);
    this.registerExtensions(extensions, type);
  }

  getViewCreatorByType(type: string): ViewCreator | undefined {
    return this.viewByType.get(type);
  }

  getTypeByExtension(extension: string): string | undefined {
    return this.typeByExtension.get(extension);
  }

  canAcceptExtension(type: string, extension: string): boolean {
    return this.typeByExtension.get(extension) === type;
  }

  isExtensionRegistered(extension: string): boolean {
    return this.typeByExtension.has(extension);
  }

  createView(type: string, leaf: WorkspaceLeaf): View {
    const creator = this.getViewCreatorByType(type);
    if (!creator) throw new Error(`Unknown view type: ${type}`);
    return creator(leaf);
  }

  getViewTypeByExtension(extension: string): string | null {
    return this.getTypeByExtension(extension) ?? null;
  }
}
