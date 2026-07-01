import { createDiv } from "../dom/dom";
import { setIcon } from "../ui/Icon";
import { getObsidianPlatformClass } from "./BodyClasses";

export interface FrameDomOptions {
  hidden?: boolean;
  win?: Window;
}

interface FrameElectronWindow {
  minimizable?: boolean;
  maximizable?: boolean;
  closable?: boolean;
  webContents?: { getZoomFactor?: () => number };
  isFullScreen?: () => boolean;
  isMaximized?: () => boolean;
  minimize?: () => void;
  maximize?: () => void;
  unmaximize?: () => void;
  close?: () => void;
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
      const electronWindow = (this.win as Window & { electronWindow?: FrameElectronWindow }).electronWindow;
      this.createTitlebarButton(this.leftButtonContainerEl, "mod-logo", "lucide-gem", "Obsidian");
      if (electronWindow?.minimizable !== false) {
        this.createTitlebarButton(this.rightButtonContainerEl, "mod-minimize", "lucide-minus", "Minimize", () => electronWindow?.minimize?.());
      }
      if (electronWindow?.maximizable !== false) {
        const maximizeButton = this.createTitlebarButton(this.rightButtonContainerEl, "mod-maximize", "lucide-maximize-2", "Maximize", () => {
          if (electronWindow?.isMaximized?.()) electronWindow.unmaximize?.();
          else electronWindow?.maximize?.();
          this.updateMaximizeButton(maximizeButton, electronWindow);
        });
        this.updateMaximizeButton(maximizeButton, electronWindow);
        this.win.addEventListener("resize", () => this.updateMaximizeButton(maximizeButton, electronWindow));
      }
      if (electronWindow?.closable !== false) {
        this.createTitlebarButton(this.rightButtonContainerEl, "mod-close", "lucide-x", "Close", () => {
          if (electronWindow?.close) electronWindow.close();
          else this.win.close();
        });
      }
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

  private createTitlebarButton(parent: HTMLElement, modifier: string, icon: string, title: string, onClick?: () => void): HTMLElement {
    const button = createDiv(`titlebar-button ${modifier}`, parent);
    button.title = title;
    button.setAttribute("aria-label", title);
    setIcon(button, icon);
    if (onClick) button.addEventListener("click", onClick);
    return button;
  }

  private updateMaximizeButton(button: HTMLElement, electronWindow?: FrameElectronWindow): void {
    const maximized = Boolean(electronWindow?.isMaximized?.());
    button.title = maximized ? "Restore down" : "Maximize";
    button.setAttribute("aria-label", button.title);
    setIcon(button, maximized ? "lucide-copy" : "lucide-maximize-2");
  }
}

function parseCssNumber(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
