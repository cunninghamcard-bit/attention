import { createSpan } from "../dom/dom";

// The one status dot every agent surface shares (timeline headers, board
// cards, participant chips). State is a modifier class, animation lives in
// CSS — replacing three hand-rolled dots with one vocabulary:
//   idle     neutral        done    green
//   on       accent         failed  red
//   running  accent, pulsing
export type StatusDotState = "idle" | "on" | "running" | "done" | "failed";

const STATES: StatusDotState[] = ["idle", "on", "running", "done", "failed"];

export function createStatusDot(parentEl: HTMLElement, state: StatusDotState, extraCls = ""): HTMLElement {
  const el = createSpan({ cls: `chat-status-dot${extraCls ? ` ${extraCls}` : ""}`, parent: parentEl });
  setStatusDot(el, state);
  return el;
}

export function setStatusDot(el: HTMLElement, state: StatusDotState): void {
  for (const other of STATES) el.classList.remove(`is-${other}`);
  el.classList.add(`is-${state}`);
}
