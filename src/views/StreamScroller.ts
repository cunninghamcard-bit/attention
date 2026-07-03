import { createEl } from "../dom/dom";
import { Component } from "../core/Component";

const BOTTOM_THRESHOLD = 48;

// Stick-to-bottom state machine: follow the stream while the user is at the
// bottom, detach the moment they scroll up, offer a way back down.
export class StreamScroller extends Component {
  private readonly buttonEl: HTMLElement;
  private stuck = true;

  constructor(private readonly scrollEl: HTMLElement, overlayEl: HTMLElement) {
    super();
    this.buttonEl = createEl("button", { cls: "stream-scroll-bottom", parent: overlayEl, text: "↓" });
    this.buttonEl.hide();
  }

  override onload(): void {
    this.registerDomEvent(this.scrollEl, "scroll", () => {
      this.stuck = this.isAtBottom();
      if (this.stuck) this.buttonEl.hide();
    });
    this.registerDomEvent(this.buttonEl as HTMLElement, "click", () => this.scrollToBottom());
  }

  notifyContentChanged(): void {
    if (this.stuck) this.scrollToBottom();
    else this.buttonEl.show();
  }

  // Leave follow mode regardless of scroll position — anchored reading
  // (question pinned, reply growing below) must not fight scrollToBottom.
  detach(): void {
    this.stuck = false;
  }

  scrollToBottom(): void {
    this.scrollEl.scrollTop = this.scrollEl.scrollHeight;
    this.stuck = true;
    this.buttonEl.hide();
  }

  private isAtBottom(): boolean {
    return this.scrollEl.scrollHeight - this.scrollEl.scrollTop - this.scrollEl.clientHeight <= BOTTOM_THRESHOLD;
  }
}
