import { createDiv } from "../dom/dom";

export class AppDom {
  readonly appContainerEl: HTMLElement;
  readonly horizontalMainContainerEl: HTMLElement;
  readonly workspaceEl: HTMLElement;
  readonly statusBarEl: HTMLElement;

  constructor(parent: HTMLElement = document.body) {
    this.appContainerEl = createDiv("app-container", parent);
    this.horizontalMainContainerEl = this.appContainerEl.createDiv("horizontal-main-container");
    this.workspaceEl = this.horizontalMainContainerEl.createDiv("workspace");
    this.statusBarEl = this.appContainerEl.createDiv("status-bar");
  }
}
