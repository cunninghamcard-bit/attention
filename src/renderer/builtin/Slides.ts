import type { App } from "../app/App";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../plugin/InternalPluginWrapper";
import { MarkdownRenderer } from "../markdown/MarkdownRenderer";
import { MarkdownView } from "../views/MarkdownView";
import { TFile } from "../vault/TAbstractFile";

export class SlidesController {
  private containerEl: HTMLElement | null = null;
  private slides: string[] = [];
  private index = 0;
  private sourcePath = "";

  constructor(readonly app: App) {}

  async start(): Promise<void> {
    const file = this.getActiveMarkdownFile();
    if (!file) return;
    const source = await this.app.vault.read(file);
    this.sourcePath = file.path;
    this.slides = splitSlides(source);
    this.index = 0;
    this.openDeck();
    await this.renderCurrentSlide();
  }

  close(): void {
    this.containerEl?.remove();
    this.containerEl = null;
    this.slides = [];
    this.index = 0;
    this.app.workspace.trigger("slides-close");
  }

  private openDeck(): void {
    this.close();
    const containerEl = document.createElement("div");
    containerEl.className = "slides-container";
    containerEl.tabIndex = -1;

    const closeEl = document.createElement("button");
    closeEl.className = "slides-close-btn clickable-icon";
    closeEl.type = "button";
    closeEl.dataset.icon = "lucide-x";
    closeEl.title = "Close presentation";
    closeEl.textContent = "Close";
    closeEl.addEventListener("click", () => this.close());

    const revealEl = document.createElement("div");
    revealEl.className = "reveal";
    const slidesEl = document.createElement("div");
    slidesEl.className = "slides";
    revealEl.appendChild(slidesEl);

    const navEl = document.createElement("div");
    navEl.className = "slides-navigation";
    const prevEl = document.createElement("button");
    prevEl.type = "button";
    prevEl.textContent = "Previous";
    prevEl.addEventListener("click", () => void this.go(-1));
    const nextEl = document.createElement("button");
    nextEl.type = "button";
    nextEl.textContent = "Next";
    nextEl.addEventListener("click", () => void this.go(1));
    navEl.append(prevEl, nextEl);

    containerEl.append(closeEl, revealEl, navEl);
    containerEl.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.close();
      if (event.key === "ArrowLeft") void this.go(-1);
      if (event.key === "ArrowRight" || event.key === " ") void this.go(1);
    });
    document.body.appendChild(containerEl);
    containerEl.focus();
    this.containerEl = containerEl;
    this.app.workspace.trigger("slides-open", this.sourcePath);
  }

  private async go(delta: number): Promise<void> {
    if (!this.containerEl || this.slides.length === 0) return;
    this.index = Math.max(0, Math.min(this.slides.length - 1, this.index + delta));
    await this.renderCurrentSlide();
  }

  private async renderCurrentSlide(): Promise<void> {
    const slidesEl = this.containerEl?.querySelector<HTMLElement>(".slides");
    if (!slidesEl) return;
    slidesEl.replaceChildren();
    const sectionEl = document.createElement("section");
    sectionEl.className = "markdown-preview-view markdown-rendered";
    slidesEl.appendChild(sectionEl);
    await MarkdownRenderer.render(
      this.app,
      this.slides[this.index] ?? "",
      sectionEl,
      this.sourcePath,
    );
    const progressEl = document.createElement("div");
    progressEl.className = "slides-progress";
    progressEl.textContent = `${this.index + 1} / ${Math.max(1, this.slides.length)}`;
    slidesEl.appendChild(progressEl);
  }

  private getActiveMarkdownFile(): TFile | null {
    const view = this.app.workspace.activeLeaf?.view;
    if (view instanceof MarkdownView && view.file instanceof TFile) return view.file;
    return null;
  }
}

export function createSlidesPluginDefinition(): InternalPluginDefinition {
  let controller: SlidesController | null = null;
  return {
    id: "slides",
    name: "Slides",
    description: "Present the active Markdown file as slides.",
    defaultOn: false,
    init(app: App, plugin: InternalPluginWrapper) {
      controller = new SlidesController(app);
      plugin.instance = controller;
      plugin.registerGlobalCommand({
        id: "slides:start",
        name: "Start presentation",
        icon: "lucide-presentation",
        checkCallback: (checking) => {
          const available = app.workspace.activeLeaf?.view instanceof MarkdownView;
          if (!checking && available) void controller?.start();
          return available;
        },
      });
    },
    onDisable() {
      controller?.close();
    },
  };
}

export function splitSlides(source: string): string[] {
  const slides = source
    .split(/^\s*(?:---|\*\*\*|___)\s*$/m)
    .map((slide) => slide.trim())
    .filter(Boolean);
  return slides.length > 0 ? slides : [source];
}
