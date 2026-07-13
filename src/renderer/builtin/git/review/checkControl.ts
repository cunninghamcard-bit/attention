import { createSpan } from "../../../dom/dom";
import { setIcon } from "../../../ui/Icon";

export type CheckState = "on" | "off" | "partial";

/** codiff's wt-check: an 18px rounded toggle — filled check, tinted dash, or empty. */
export function renderCheck(state: CheckState, parent?: HTMLElement): HTMLSpanElement {
  const el = createSpan(
    `git-check${state === "on" ? " is-on" : state === "partial" ? " is-partial" : ""}`,
    parent,
  );
  if (state === "on") setIcon(el, "lucide-check");
  else if (state === "partial") createSpan("git-check-dash", el);
  return el;
}
