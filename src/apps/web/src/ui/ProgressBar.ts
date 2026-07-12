import { getActiveDocument } from "../dom/ActiveDocument";

export class ProgressBar {
  private static progressBarInstance: ProgressBar | null = null;

  readonly doc: Document;
  readonly containerEl: HTMLElement;
  readonly progressBarEl: HTMLElement;
  readonly messageEl: HTMLElement;
  readonly indicatorEl: HTMLElement;
  readonly lineEl: HTMLElement;
  readonly line1El: HTMLElement;
  readonly line2El: HTMLElement;
  readonly contextEl: HTMLElement;

  static get instance(): ProgressBar {
    this.progressBarInstance ??= new ProgressBar();
    return this.progressBarInstance;
  }

  constructor(doc: Document = getActiveDocument()) {
    this.doc = doc;
    this.containerEl = doc.createElement("div");
    this.containerEl.className = "progress-bar-container";
    this.progressBarEl = doc.createElement("div");
    this.progressBarEl.className = "progress-bar";
    this.messageEl = doc.createElement("div");
    this.messageEl.className = "progress-bar-message u-center-text";
    this.indicatorEl = doc.createElement("div");
    this.indicatorEl.className = "progress-bar-indicator";
    this.lineEl = doc.createElement("div");
    this.lineEl.className = "progress-bar-line";
    this.line1El = doc.createElement("div");
    this.line1El.className = "progress-bar-subline mod-increase";
    this.line2El = doc.createElement("div");
    this.line2El.className = "progress-bar-subline mod-decrease";
    this.contextEl = doc.createElement("div");
    this.contextEl.className = "progress-bar-context";
    this.indicatorEl.append(this.lineEl, this.line1El, this.line2El);
    this.progressBarEl.append(this.messageEl, this.indicatorEl, this.contextEl);
    this.containerEl.appendChild(this.progressBarEl);
    this.containerEl.addEventListener("click", (event) => event.preventDefault());
    this.setUnknownProgress();
  }

  show(): this {
    if (this.containerEl.parentElement !== this.doc.body) this.doc.body.prepend(this.containerEl);
    this.doc.body.classList.add("in-progress");
    this.containerEl.style.opacity = "";
    return this;
  }

  hide(): this {
    this.containerEl.remove();
    this.doc.body.classList.remove("in-progress");
    return this;
  }

  setMessage(message: string): this {
    this.messageEl.textContent = message;
    return this;
  }

  setUnknownProgress(): this {
    this.progressBarEl.classList.add("is-indeterminate");
    this.lineEl.style.width = "";
    return this;
  }

  setProgress(done: number, total: number): this {
    this.progressBarEl.classList.remove("is-indeterminate");
    const value = total > 0 ? Math.max(0, Math.min(100, (done / total) * 100)) : 0;
    this.lineEl.style.width = `${value}%`;
    return this;
  }

  clearContext(): this {
    this.contextEl.replaceChildren();
    return this;
  }

  setContext(callback: (el: HTMLElement) => void): this {
    this.clearContext();
    callback(this.contextEl);
    return this;
  }
}
