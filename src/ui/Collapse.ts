import { createDiv } from "../dom/dom";

// Animated collapsible region, the vanilla counterpart of a motion-height
// component: height:auto cannot transition, grid-template-rows fractions
// can, so the body sits inside a clip row that animates 1fr <-> 0fr. The
// caller names the classes, so existing selector contracts (timeline,
// thinking card) keep working unchanged. State is one class on the root:
// `.is-collapsed`. Not exported from the obsidian module — app vocabulary.
export interface CollapseClasses {
  header: string;
  clip: string;
  body: string;
}

export class Collapse {
  readonly headerEl: HTMLElement;
  readonly bodyEl: HTMLElement;
  // Set once the user has toggled by hand; auto-collapse logic checks it so
  // it never fights an explicit choice.
  userToggled = false;

  constructor(
    readonly rootEl: HTMLElement,
    classes: CollapseClasses,
    onUserToggle?: (collapsed: boolean) => void,
  ) {
    this.headerEl = createDiv(classes.header, rootEl);
    const clipEl = createDiv(classes.clip, rootEl);
    this.bodyEl = createDiv(classes.body, clipEl);
    this.headerEl.addEventListener("click", () => {
      this.userToggled = true;
      this.setCollapsed(!this.isCollapsed());
      onUserToggle?.(this.isCollapsed());
    });
  }

  isCollapsed(): boolean {
    return this.rootEl.hasClass("is-collapsed");
  }

  setCollapsed(value: boolean): void {
    this.rootEl.toggleClass("is-collapsed", value);
  }
}
