import { createDiv } from "../dom/dom";
import { FileView } from "./FileView";
import { ItemView } from "./ItemView";
import type { InternalViewStateResult } from "./View";
import type { TFile } from "../vault/TAbstractFile";
import { ReleaseNotesBuilder } from "../app/release/ReleaseNotes";

export const IMAGE_EXTENSIONS = ["bmp", "png", "jpg", "jpeg", "gif", "svg", "webp", "avif"];
export const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "3gp", "flac", "ogg", "oga", "opus"];
export const VIDEO_EXTENSIONS = ["mp4", "webm", "ogv", "mov", "mkv"];
export const PDF_EXTENSIONS = ["pdf"];

abstract class ResourceFileView extends FileView {
  private objectUrl: string | null = null;

  protected async getResourceUrl(file: TFile, mimeType: string): Promise<string> {
    const resourcePath = this.app.vault.getResourcePath(file);
    if (resourcePath) return resourcePath;

    const data = await this.app.vault.readBinary(file);
    const url = URL.createObjectURL(new Blob([data], { type: mimeType }));
    this.objectUrl = url;
    return url;
  }

  protected revokeResourceUrl(): void {
    if (!this.objectUrl) return;
    URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  override async onUnloadFile(_file: TFile): Promise<void> {
    this.revokeResourceUrl();
    this.contentEl.replaceChildren();
  }
}

export class ImageView extends ResourceFileView {
  static readonly VIEW_TYPE = "image";
  icon = "lucide-image";

  getViewType(): string {
    return ImageView.VIEW_TYPE;
  }

  canAcceptExtension(extension: string): boolean {
    return IMAGE_EXTENSIONS.includes(extension);
  }

  override async onLoadFile(file: TFile): Promise<void> {
    this.contentEl.replaceChildren();
    const container = createDiv("image-container", this.contentEl);
    const image = document.createElement("img");
    image.alt = file.basename;
    image.src = await this.getResourceUrl(file, mimeForExtension(file.extension, "image/*"));
    container.appendChild(image);
  }
}

export class AudioView extends ResourceFileView {
  static readonly VIEW_TYPE = "audio";
  icon = "lucide-file-audio";

  getViewType(): string {
    return AudioView.VIEW_TYPE;
  }

  canAcceptExtension(extension: string): boolean {
    return AUDIO_EXTENSIONS.includes(extension);
  }

  override async onLoadFile(file: TFile): Promise<void> {
    this.contentEl.replaceChildren();
    const container = createDiv("audio-container", this.contentEl);
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.setAttribute("controlsList", "nodownload");
    audio.src = await this.getResourceUrl(file, mimeForExtension(file.extension, "audio/*"));
    container.appendChild(audio);
  }

  override async onUnloadFile(file: TFile): Promise<void> {
    this.contentEl.querySelectorAll("audio").forEach((audio) => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    });
    await super.onUnloadFile(file);
  }
}

export class VideoView extends ResourceFileView {
  static readonly VIEW_TYPE = "video";
  icon = "lucide-file-video";

  getViewType(): string {
    return VideoView.VIEW_TYPE;
  }

  canAcceptExtension(extension: string): boolean {
    return VIDEO_EXTENSIONS.includes(extension);
  }

  override async onLoadFile(file: TFile): Promise<void> {
    this.contentEl.replaceChildren();
    const container = createDiv("video-container", this.contentEl);
    const video = document.createElement("video");
    video.controls = true;
    video.preload = "metadata";
    video.src = `${await this.getResourceUrl(file, mimeForExtension(file.extension, "video/*"))}#t=0.001`;
    container.appendChild(video);
  }

  override async onUnloadFile(file: TFile): Promise<void> {
    this.contentEl.querySelectorAll("video").forEach((video) => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    });
    await super.onUnloadFile(file);
  }
}

export class PdfView extends ResourceFileView {
  static readonly VIEW_TYPE = "pdf";
  icon = "lucide-file-text";

  getViewType(): string {
    return PdfView.VIEW_TYPE;
  }

  override async onLoadFile(file: TFile): Promise<void> {
    this.contentEl.replaceChildren();
    const container = createDiv("pdf-container", this.contentEl);
    const toolbar = createDiv("pdf-toolbar", container);
    toolbar.textContent = file.basename;
    const content = createDiv("pdf-content-container", container);
    const viewerContainer = createDiv("pdf-viewer-container", content);
    const frame = document.createElement("iframe");
    frame.className = "pdfViewer";
    frame.src = await this.getResourceUrl(file, "application/pdf");
    viewerContainer.appendChild(frame);
  }

  override setEphemeralState(state: unknown): void {
    super.setEphemeralState(state);
    if (!state || typeof state !== "object" || !("subpath" in state)) return;
    const subpath = (state as { subpath?: unknown }).subpath;
    const frame = this.contentEl.querySelector("iframe.pdfViewer");
    if (frame instanceof HTMLIFrameElement && typeof subpath === "string" && subpath) {
      frame.src = `${frame.src.split("#")[0]}#${subpath.replace(/^#/, "")}`;
    }
  }
}

export class ReleaseNotesView extends ItemView {
  static readonly VIEW_TYPE = "release-notes";
  icon = "lucide-scroll-text";
  navigation = true;
  currentVersion = "current";

  getViewType(): string {
    return ReleaseNotesView.VIEW_TYPE;
  }

  getDisplayText(): string {
    return `Release notes ${this.currentVersion}`;
  }

  getState(): Record<string, unknown> {
    return {
      currentVersion: this.currentVersion,
    };
  }

  async setState(state: unknown, result?: InternalViewStateResult): Promise<void> {
    await super.setState(state, result);
    const version = state && typeof state === "object" && "currentVersion" in state
      ? (state as { currentVersion?: unknown }).currentVersion
      : null;
    const nextVersion = typeof version === "string" && version.trim() ? version.trim() : "current";
    if (nextVersion === this.currentVersion && this.contentEl.childElementCount > 0) return;
    this.currentVersion = nextVersion;
    this.render();
    if (result) result.layout = true;
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  private render(): void {
    this.contentEl.replaceChildren();
    const container = createDiv("release-notes-view markdown-rendered", this.contentEl);
    const builder = new ReleaseNotesBuilder();
    builder.addSection("Highlights", [
      "Release notes are rendered as a normal registered workspace view.",
      "This view is opened by app.showReleaseNotes(version), not by a file extension.",
    ]);
    const markdown = builder.renderMarkdown(this.currentVersion);
    const pre = document.createElement("pre");
    pre.textContent = markdown;
    container.appendChild(pre);
    this.updateHeader();
  }
}

export function mimeForExtension(extension: string | undefined, fallback: string): string {
  switch (extension) {
    case "svg":
      return "image/svg+xml";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "m4a":
      return "audio/mp4";
    case "ogg":
    case "oga":
      return "audio/ogg";
    case "opus":
      return "audio/opus";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "ogv":
      return "video/ogg";
    default:
      return fallback;
  }
}
