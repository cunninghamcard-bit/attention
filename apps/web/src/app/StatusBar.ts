export class StatusBar {
  readonly containerEl: HTMLElement;

  constructor(parent: HTMLElement) {
    if (parent.classList.contains("status-bar")) {
      this.containerEl = parent;
    } else {
      this.containerEl = document.createElement("div");
      this.containerEl.className = "status-bar";
      parent.appendChild(this.containerEl);
    }
  }

  registerStatusBarItem(): HTMLElement {
    const el = document.createElement("div");
    el.className = "status-bar-item";
    this.containerEl.appendChild(el);
    return el;
  }
}
