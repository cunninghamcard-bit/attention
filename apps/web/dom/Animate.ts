/**
 * Input: None
 * Output: AnimationSpec, animateEl, cancelAnimation
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
  timer: number;
  complete?: () => void;
  win: Window;
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
  record.win.clearTimeout(record.timer);
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
    timer: 0,
    complete,
    win: el.win,
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
    record.timer = record.win.setTimeout(record.settle, spec.duration + 50);
  });
}
