/**
 * Input: ../dom/ActiveDocument, ../dom/Animate
 * Output: Notice
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { getActiveWindow } from "../dom/ActiveDocument";
import { AnimationSpec, animateEl } from "../dom/Animate";

const noticeContainers = new WeakMap<Window, HTMLElement>();

type NoticeMessage = string | DocumentFragment;

export class Notice {
  win: Window;
  noticesEl: HTMLElement;
  containerEl: HTMLElement;
  noticeEl: HTMLElement;
  messageEl: HTMLElement;
  private buttonContainerEl: HTMLElement | null = null;
  private timerId = -1;
  private hovering = false;

  constructor(message: NoticeMessage, timeout = 4000) {
    this.win = getActiveWindow();
    const doc = this.win.document;
    let noticesEl = noticeContainers.get(this.win);
    if (!noticesEl) {
      noticesEl = doc.createElement("div");
      noticesEl.className = "notice-container";
      noticeContainers.set(this.win, noticesEl);
    }
    if (!noticesEl.isConnected) doc.body.appendChild(noticesEl);
    this.noticesEl = noticesEl;
    this.containerEl = doc.createElement("div");
    this.containerEl.className = "notice";
    this.messageEl = doc.createElement("div");
    this.messageEl.className = "notice-message";
    this.noticeEl = this.messageEl;
    this.containerEl.appendChild(this.messageEl);
    this.noticesEl.appendChild(this.containerEl);
    // Slides in from off the right edge. `to` is "" rather than a zero
    // translate, so the notice ends owning no inline transform at all.
    animateEl(
      this.containerEl,
      new AnimationSpec().addProp("transform", "translateX(350px)", "", ""),
    );
    this.setMessage(message);
    this.setAutoHide(timeout);
    this.containerEl.addEventListener("click", () => this.hide());
  }

  setMessage(message: NoticeMessage): this {
    if (typeof message === "string") {
      this.messageEl.textContent = message;
    } else {
      this.messageEl.replaceChildren();
      this.messageEl.appendChild(message);
    }
    return this;
  }

  setAutoHide(timeout: number): this {
    if (this.timerId !== -1) this.win.clearTimeout(this.timerId);
    this.timerId = -1;
    if (timeout) {
      const hideIfNotHovering = () => {
        if (!this.hovering) this.hide();
      };
      this.timerId = this.win.setTimeout(hideIfNotHovering, timeout);
      this.containerEl.addEventListener("mouseenter", () => {
        this.hovering = true;
      });
      this.containerEl.addEventListener("mouseleave", () => {
        this.hovering = false;
        this.win.setTimeout(hideIfNotHovering, 1000);
      });
    }
    return this;
  }

  addButton(text: string, callback: (event: MouseEvent) => void): this {
    if (!this.buttonContainerEl) {
      this.buttonContainerEl = this.win.document.createElement("div");
      this.buttonContainerEl.className = "notice-button-container";
      this.containerEl.appendChild(this.buttonContainerEl);
    }
    const buttonEl = this.win.document.createElement("div");
    buttonEl.className = "notice-cta";
    buttonEl.textContent = text;
    buttonEl.addEventListener("click", (event) => {
      this.hide();
      callback(event);
    });
    this.buttonContainerEl.appendChild(buttonEl);
    return this;
  }

  hide(): void {
    if (this.timerId !== -1) this.win.clearTimeout(this.timerId);
    this.timerId = -1;
    const detach = (): void => {
      this.containerEl.remove();
      if (this.noticesEl.children.length === 0) this.noticesEl.remove();
    };
    if (!this.containerEl.isConnected) return detach();
    // Fading alone would leave a hole that the notices below only close once
    // this one detaches. Collapsing the top margin by this notice's own height
    // (plus its own bottom margin) pulls the stack up in step with the fade.
    const style = this.win.getComputedStyle(this.containerEl);
    const marginBottom = Number.parseInt(style.marginBottom, 10);
    let shift = -this.containerEl.offsetHeight;
    if (!Number.isNaN(marginBottom)) shift -= marginBottom;
    animateEl(
      this.containerEl,
      new AnimationSpec({ duration: 120 })
        .addProp("opacity", "1", "0")
        .addProp("marginTop", "0px", `${shift}px`),
      detach,
    );
  }
}
