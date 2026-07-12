import { getActiveWindow } from "../dom/ActiveDocument";

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
    this.containerEl.remove();
    if (this.noticesEl.children.length === 0) this.noticesEl.remove();
  }
}
