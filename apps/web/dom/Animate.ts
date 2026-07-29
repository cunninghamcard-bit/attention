/**
 * Input: ./dom
 * Output: AnimationSpec, animateEl, cancelAnimation, expandEl, collapseEl, setElCollapsed, setChildrenCollapsed
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * Obsidian's imperative animation protocol, ported from app.js (`dl`/`yl`/
 * `vl`/`fl`).
 *
 * Most of Obsidian's motion is NOT in app.css: anything whose start or end
 * value has to be measured at runtime — a tab's natural width, a popover's
 * height — cannot be written as a static rule, so app.js animates it by
 * writing inline styles instead. This is that mechanism, and it is a shared
 * protocol: surfaces compose it rather than each hand-rolling a transition.
 *
 * The shape is deliberate in three places:
 * - `from` is applied immediately, but the transition only starts on a later
 *   task, after a forced reflow, so the browser has committed the start value
 *   and actually has something to interpolate from. Batching every pending
 *   start into ONE flush means one reflow for a whole group of elements.
 * - `transitionProperty` is narrowed to the animated keys. `transition: all`
 *   alone would drag every unrelated property along with it.
 * - `transitionend` is not trusted on its own: a transition that never starts
 *   (a zero-length change, a hidden element) never fires it, so a timer at
 *   `duration + 50` settles the animation regardless.
 *
 * `end` is the value written when the animation settles, which is how an
 * animation hands the element back to the stylesheet: animate width to a
 * measured pixel value, end it at `""`, and the final state is the CSS one.
 */

import { detach } from "./dom";

type StyleMap = Record<string, string>;

/** One animation's from/to/end style maps plus its timing. */
export class AnimationSpec {
  readonly from: StyleMap = {};
  readonly to: StyleMap = {};
  readonly end: StyleMap = {};
  readonly duration: number;
  readonly fn: string;

  constructor(options?: { duration?: number; fn?: string }) {
    this.duration = options?.duration ?? 100;
    this.fn = options?.fn ?? "ease-in-out";
  }

  /** A null stage is skipped, so a property can animate without an `end`. */
  addProp(prop: string, from: string | null, to: string | null, end: string | null = null): this {
    if (from !== null) this.from[prop] = from;
    if (to !== null) this.to[prop] = to;
    if (end !== null) this.end[prop] = end;
    return this;
  }
}

interface RunningAnimation {
  spec: AnimationSpec;
  settle: () => void;
  /** The real listener, so removing it actually removes it. */
  onTransitionEnd: (event: TransitionEvent) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  complete?: () => void;
}

const running = new WeakMap<HTMLElement, RunningAnimation>();
/** Pending starts, flushed together so one reflow serves the whole batch. */
let pendingStarts: (() => void)[] | null = null;

/**
 * Property assignment, not `setProperty`: specs are keyed the way app.js keys
 * them, in camelCase (`paddingTop`, `overflowY`), which `setProperty` rejects
 * because it takes kebab-case. Assigning `""` clears the inline value, which
 * is how a spec hands a property back to the stylesheet.
 */
function applyStyles(el: HTMLElement, styles: StyleMap): void {
  for (const prop of Object.keys(styles)) {
    (el.style as unknown as Record<string, string>)[prop] = styles[prop];
  }
}

/**
 * Settle any animation on `el`: drop the inline transition, apply the spec's
 * `end` styles and fire its completion. Safe on an element with none running.
 */
export function cancelAnimation(el: HTMLElement, silent = false): void {
  const record = running.get(el);
  running.delete(el);
  if (!record) return;
  el.style.transition = "";
  el.style.transitionProperty = "";
  applyStyles(el, record.spec.end);
  clearTimeout(record.timer);
  el.removeEventListener("transitionend", record.onTransitionEnd);
  if (!silent) record.complete?.();
}

/** Run `spec` on `el`, replacing whatever was animating there. */
export function animateEl(el: HTMLElement, spec: AnimationSpec, complete?: () => void): void {
  cancelAnimation(el);
  applyStyles(el, spec.from);

  const record: RunningAnimation = {
    spec,
    settle: () => cancelAnimation(el),
    onTransitionEnd: (event: TransitionEvent) => {
      if (event.target === el) record.settle();
    },
    timer: undefined,
    complete,
  };
  running.set(el, record);

  if (pendingStarts === null) {
    pendingStarts = [];
    setTimeout(() => {
      // Read a layout property to force the reflow that commits every `from`
      // in this batch before any transition is armed.
      void document.body.offsetHeight;
      const starts = pendingStarts ?? [];
      pendingStarts = null;
      for (const start of starts) start();
    }, 0);
  }

  pendingStarts.push(() => {
    el.style.transition = `all ${spec.duration}ms ${spec.fn}`;
    el.style.transitionProperty = Object.keys(spec.from).join(", ");
    applyStyles(el, spec.to);
    el.addEventListener("transitionend", record.onTransitionEnd);
    record.timer = setTimeout(record.settle, spec.duration + 50);
  });
}

/**
 * The vertical box metrics a height collapse interpolates, ported from app.js
 * `hl`. Padding and margin ride along with height, or a collapsing box keeps
 * its spacing and the row below it jumps.
 */
const COLLAPSE_METRICS = [
  "height",
  "paddingTop",
  "paddingBottom",
  "marginTop",
  "marginBottom",
] as const;

/** app.js `dl` timing for the collapse pair. */
const COLLAPSE_DURATION = 100;
const COLLAPSE_EASING = "cubic-bezier(.02, .01, .47, 1)";

/**
 * The element's current metrics in pixels, ported from app.js `ml`. Zero
 * values are DROPPED, not recorded as 0: a box with no padding should animate
 * height alone, and listing a property that never changes only widens
 * `transitionProperty` for nothing.
 */
function measureCollapseMetrics(el: HTMLElement): Record<string, number> {
  const computed = window.getComputedStyle(el);
  const metrics: Record<string, number> = {};
  for (const prop of COLLAPSE_METRICS) {
    const raw = computed[prop];
    if (!raw || !raw.endsWith("px")) continue;
    const value = Number.parseFloat(raw.slice(0, -2));
    if (value !== 0) metrics[prop] = value;
  }
  return metrics;
}

function collapseSpec(el: HTMLElement, expanding: boolean): AnimationSpec {
  const metrics = measureCollapseMetrics(el);
  const spec = new AnimationSpec({ duration: COLLAPSE_DURATION, fn: COLLAPSE_EASING });
  // Clipped for the whole run so the contents cannot spill out of a box that
  // is shorter than they are, then released by the `end` stage.
  spec.addProp("overflowY", "clip", "clip", "");
  for (const prop of Object.keys(metrics)) {
    const natural = `${metrics[prop]}px`;
    spec.addProp(prop, expanding ? "0px" : natural, expanding ? natural : "0px", "");
  }
  return spec;
}

/** Grow an element from nothing to its natural box (app.js `bl`). */
export function expandEl(el: HTMLElement): Promise<void> {
  cancelAnimation(el);
  return new Promise((resolve) => animateEl(el, collapseSpec(el, true), () => resolve()));
}

/** Shrink an element to nothing, keeping its natural box as the start (app.js `wl`). */
export function collapseEl(el: HTMLElement): Promise<void> {
  cancelAnimation(el);
  return new Promise((resolve) => animateEl(el, collapseSpec(el, false), () => resolve()));
}

/**
 * Collapse/expand an element in place, ported from app.js `kl`: it settles
 * first, and the element is hidden only AFTER it has finished shrinking, so
 * the animation is not cut off by `display: none`.
 */
export async function setElCollapsed(
  el: HTMLElement,
  collapsed: boolean,
  animate: boolean,
): Promise<void> {
  cancelAnimation(el);
  if (collapsed) {
    if (animate) await collapseEl(el);
    el.style.display = "none";
  } else {
    el.style.display = "";
    if (animate) await expandEl(el);
  }
}

/**
 * The tree-item variant, ported from app.js `Cl`. Two differences from
 * `setElCollapsed` and both are deliberate: the collapsed element is DETACHED
 * rather than hidden — a tree's children box leaves the document, which is
 * what keeps a deep collapsed tree out of layout entirely — and it is
 * re-appended to `parent` on the way back. It also does NOT pre-settle, so a
 * toggle mid-animation continues from where the box currently is.
 */
export async function setChildrenCollapsed(
  el: HTMLElement,
  parent: HTMLElement,
  collapsed: boolean,
  animate: boolean,
): Promise<void> {
  if (collapsed) {
    if (animate) await collapseEl(el);
    detach(el);
  } else {
    el.style.display = "";
    parent.appendChild(el);
    if (animate) await expandEl(el);
  }
}
