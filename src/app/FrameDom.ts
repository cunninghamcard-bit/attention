import { createDiv } from "../dom/dom";
import { setIcon } from "../ui/Icon";
import { getObsidianPlatformClass } from "./BodyClasses";

export interface FrameDomOptions {
  hidden?: boolean;
  win?: Window;
}

interface FrameElectronWindow {
  webContents?: { getZoomFactor?: () => number };
  isFullScreen?: () => boolean;
  isMaximized?: () => boolean;
  setWindowButtonPosition?: (position: { x: number; y: number }) => void;
  setTrafficLightPosition?: (position: { x: number; y: number }) => void;
}

export class FrameDom {
  readonly win: Window;
  readonly doc: Document;
  readonly titleBarEl: HTMLElement;
  readonly titleBarInnerEl: HTMLElement;
  readonly titleBarTextEl: HTMLElement;
  readonly leftButtonContainerEl: HTMLElement;
  readonly rightButtonContainerEl: HTMLElement;

  constructor(doc: Document = document, options: FrameDomOptions = {}) {
    this.doc = doc;
    this.win = options.win ?? doc.defaultView ?? window;
    (this.win as Window & { frameDom?: FrameDom }).frameDom = this;
    const body = doc.body;
    body.classList.add("is-frameless");
    body.classList.toggle("is-hidden-frameless", options.hidden !== false);

    this.titleBarEl = doc.createElement("div");
    this.titleBarEl.className = "titlebar";
    body.insertBefore(this.titleBarEl, body.firstChild);

    this.titleBarInnerEl = createDiv("titlebar-inner", this.titleBarEl);
    this.titleBarTextEl = createDiv({ cls: "titlebar-text", text: "Obsidian" }, this.titleBarInnerEl);
    this.leftButtonContainerEl = createDiv("titlebar-button-container mod-left", this.titleBarInnerEl);
    this.rightButtonContainerEl = createDiv("titlebar-button-container mod-right", this.titleBarInnerEl);

    if (getObsidianPlatformClass(this.win) !== "mod-macos") {
      this.createTitlebarButton(this.leftButtonContainerEl, "mod-logo", "lucide-gem", "Obsidian");
      this.createTitlebarButton(this.rightButtonContainerEl, "mod-minimize", "lucide-minus", "Minimize");
      this.createTitlebarButton(this.rightButtonContainerEl, "mod-maximize", "lucide-maximize-2", "Maximize");
      this.createTitlebarButton(this.rightButtonContainerEl, "mod-close", "lucide-x", "Close");
    }

    this.updateTitle();
    this.updateStatus();
  }

  updateTitle(title = this.doc.title || "Obsidian"): void {
    this.titleBarTextEl.textContent = title || "Obsidian";
  }

  updateStatus(): void {
    const body = this.doc.body;
    const win = this.win as Window & { electronWindow?: FrameElectronWindow; isMaximized?: () => boolean; titlebarStyle?: string; zoomFactor?: number };
    const electronWindow = win.electronWindow;
    const zoomFactor = electronWindow?.webContents?.getZoomFactor?.() ?? win.zoomFactor ?? 1;
    body.classList.toggle("is-fullscreen", Boolean(electronWindow?.isFullScreen?.() ?? this.doc.fullscreenElement));
    body.classList.toggle("is-maximized", Boolean(electronWindow?.isMaximized?.() ?? win.isMaximized?.()));
    body.style.setProperty("--zoom-factor", String(zoomFactor));
    const setTrafficLightPosition = electronWindow?.setWindowButtonPosition ?? electronWindow?.setTrafficLightPosition;
    if (!setTrafficLightPosition || win.titlebarStyle !== "hidden" || !body.classList.contains("mod-macos")) return;
    const style = this.win.getComputedStyle(body);
    const offsetX = parseCssNumber(style.getPropertyValue("--traffic-lights-offset-x"), 40);
    let offsetY = parseCssNumber(style.getPropertyValue("--traffic-lights-offset-y"), 40);
    if (offsetY === 0) offsetY = 40;
    const position = (offset: number) => {
      const value = Math.floor((offset * zoomFactor) / 2 - 8);
      return value < -5 ? 0 : value;
    };
    setTrafficLightPosition.call(electronWindow, { x: position(offsetX) + 2, y: position(offsetY) });
  }

  remove(): void {
    this.titleBarEl.remove();
    const win = this.win as Window & { frameDom?: FrameDom };
    if (win.frameDom === this) delete win.frameDom;
  }

  private createTitlebarButton(parent: HTMLElement, modifier: string, icon: string, title: string): HTMLElement {
    const button = createDiv(`titlebar-button ${modifier}`, parent);
    button.title = title;
    button.setAttribute("aria-label", title);
    setIcon(button, icon);
    return button;
  }
}

function parseCssNumber(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
