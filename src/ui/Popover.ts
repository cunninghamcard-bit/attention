import { getActiveDocument, getActiveWindow } from "../dom/ActiveDocument";
import { Component } from "../core/Component";

export enum PopoverState {
  Showing = 0,
  Shown = 1,
  Hiding = 2,
  Hidden = 3,
}

export const HoverPopoverState = PopoverState;

export interface HoverParent {
  hoverPopover: HoverPopover | null;
}

export interface Point {
  x: number;
  y: number;
}

export class HoverPopover extends Component {
  readonly hoverEl: HTMLElement;
  readonly contentEl: HTMLElement;
  state = HoverPopoverState.Hidden;
  waitTime = 300;
  staticPos: Point | null = null;
  isFocused = false;
  private parent: HoverParent | null = null;
  private targetEl: HTMLElement | null = null;
  private onTarget = true;
  private onHover = false;
  private timer = 0;
  private observer: ResizeObserver | null = null;
  private resizeCount = 0;
  private cleanupTarget: Array<() => void> = [];

  constructor(parentEl?: HTMLElement);
  constructor(parent: HoverParent, targetEl: HTMLElement | null, waitTime?: number, staticPos?: Point | null);
  constructor(
    parentOrEl: HoverParent | HTMLElement = getActiveDocument().body,
    targetEl?: HTMLElement | null,
    waitTime = 300,
    staticPos: Point | null = null,
  ) {
    super();
    const isLegacyParentEl = isHTMLElementLike(parentOrEl);
    const doc = isLegacyParentEl
      ? parentOrEl.ownerDocument
      : targetEl?.ownerDocument ?? getActiveDocument();
    if (!isLegacyParentEl) {
      this.parent = parentOrEl;
      this.waitTime = waitTime;
      this.staticPos = staticPos;
      this.targetEl = targetEl ?? null;
      this.state = HoverPopoverState.Showing;
    }
    this.hoverEl = doc.createElement("div");
    this.hoverEl.className = "popover hover-popover";
    this.contentEl = this.hoverEl;
    this.hoverEl.addEventListener("mouseover", this.onMouseIn);
    this.hoverEl.addEventListener("mouseout", this.onMouseOut);
    if (!isLegacyParentEl) {
      if (targetEl) this.attachTargetListeners(targetEl);
      this.timer = getOwnerWindow(this.hoverEl).setTimeout(() => this.show(), this.waitTime);
      addPendingHover(this);
    }
  }

  showAt(target: HTMLElement): void {
    this.clearTimer();
    this.detachTargetListeners();
    this.targetEl = target;
    this.onTarget = true;
    this.onHover = false;
    this.state = HoverPopoverState.Showing;
    this.attachTargetListeners(target);
    this.timer = getOwnerWindow(target).setTimeout(() => this.show(), this.waitTime);
    addPendingHover(this);
  }

  hide(): void {
    if (this.state === HoverPopoverState.Hidden) return;
    this.state = HoverPopoverState.Hidden;
    removePendingHover(this);
    removeShownHover(this);
    this.clearTimer();
    this.disconnectResizeObserver();
    this.detachTargetListeners();
    for (const child of this.childHovers) child.hide();
    if (this.parent?.hoverPopover === this) this.parent.hoverPopover = null;
    this.hoverEl.remove();
    this.onTarget = false;
    this.onHover = false;
    this.onHide();
    this.unload();
    stopHoverPollingIfIdle();
  }

  onShow(): void {
    if (!this.parent) return;
    const previous = this.parent.hoverPopover;
    if (previous && previous !== this) previous.hide();
    this.parent.hoverPopover = this;
  }

  onHide(): void {}

  setIsFocused(focused: boolean): void {
    this.isFocused = focused;
    this.transition();
  }

  detect(node: Element | null): void {
    const target = this.targetEl;
    this.onTarget = Boolean(target && node && (node === target || target.contains(node)));
    this.onHover = Boolean(node && (node === this.hoverEl || this.hoverEl.contains(node)));
  }

  transition(): void {
    const shouldShow = this.shouldShow();
    if (shouldShow) {
      if (this.state === HoverPopoverState.Hiding) {
        this.state = HoverPopoverState.Shown;
        this.clearTimer();
      }
      return;
    }
    if (this.state === HoverPopoverState.Showing) {
      this.hide();
    } else if (this.state === HoverPopoverState.Shown) {
      this.state = HoverPopoverState.Hiding;
      this.timer = getOwnerWindow(this.hoverEl).setTimeout(() => {
        if (this.shouldShow()) this.transition();
        else this.hide();
      }, this.waitTime);
    }
  }

  show(): void {
    if (this.state !== HoverPopoverState.Showing || (this.targetEl && !this.targetEl.ownerDocument.body.contains(this.targetEl))) {
      this.hide();
      return;
    }
    this.state = HoverPopoverState.Shown;
    this.timer = 0;
    this.position();
    this.onShow();
    removePendingHover(this);
    addShownHover(this);
    this.load();
    this.watchResize(this.hoverEl);
    stopHoverPollingIfIdle();
  }

  private position(): void {
    const target = this.targetEl;
    let doc = getActiveDocument();
    let rect: RectLike = this.staticPos
      ? pointRect(this.staticPos)
      : { top: 0, bottom: 0, left: 0, right: 0 };
    let rtl = false;
    if (!this.staticPos && target) {
      rect = target.getBoundingClientRect();
      rtl = getComputedStyle(target).direction === "rtl";
      const mapped = projectRectToTopWindow(rect, target.ownerDocument.defaultView ?? window);
      rect = mapped.rect;
      doc = mapped.win.document;
    }
    const win = doc.defaultView ?? window;
    if (this.hoverEl.parentElement !== doc.body) doc.body.appendChild(this.hoverEl);
    const width = Math.min(450, Math.max(280, win.innerWidth * 0.8));
    const height = Math.min(400, Math.max(180, win.innerHeight * 0.8));
    const alignedLeft = rtl ? rect.right - width : rect.left;
    const left = Math.min(Math.max(8, alignedLeft), Math.max(8, win.innerWidth - width - 8));
    const top = rect.bottom + 10 + height > win.innerHeight ? Math.max(8, rect.top - height - 10) : rect.bottom + 10;
    this.hoverEl.style.position = "fixed";
    this.hoverEl.style.left = `${left}px`;
    this.hoverEl.style.top = `${top}px`;
    this.hoverEl.style.maxWidth = "80vw";
    this.hoverEl.style.width = `${width}px`;
    this.hoverEl.style.maxHeight = `${height}px`;
  }

  private shouldShow(): boolean {
    return this.shouldShowSelf() || this.childHovers.some((hover) => hover.shouldShow());
  }

  private shouldShowSelf(): boolean {
    return this.onTarget || this.onHover || this.isFocused || this.hoverEl.contains(this.hoverEl.ownerDocument.activeElement);
  }

  get childHovers(): HoverPopover[] {
    return shownHoverPopovers.filter((hover) => hover !== this && Boolean(hover.targetEl && this.hoverEl.contains(hover.targetEl)));
  }

  private attachTargetListeners(target: HTMLElement): void {
    const enter = (event: MouseEvent) => {
      if (!isBoundaryMouseEvent(event, target)) return;
      this.onTarget = true;
      this.transition();
    };
    const leave = (event: MouseEvent) => {
      if (!isBoundaryMouseEvent(event, target)) return;
      this.onTarget = false;
      this.transition();
    };
    target.addEventListener("mouseover", enter);
    target.addEventListener("mouseout", leave);
    this.cleanupTarget.push(() => target.removeEventListener("mouseover", enter));
    this.cleanupTarget.push(() => target.removeEventListener("mouseout", leave));
  }

  private detachTargetListeners(): void {
    for (const cleanup of this.cleanupTarget.splice(0)) cleanup();
  }

  private clearTimer(): void {
    if (this.timer) getOwnerWindow(this.hoverEl).clearTimeout(this.timer);
    this.timer = 0;
  }

  private onMouseIn = (event: MouseEvent): void => {
    if (!isBoundaryMouseEvent(event, this.hoverEl)) return;
    this.onHover = true;
    this.transition();
  };

  private onMouseOut = (event: MouseEvent): void => {
    if (!isBoundaryMouseEvent(event, this.hoverEl)) return;
    this.onHover = false;
    this.transition();
  };

  watchResize(el: Element): void {
    if (typeof ResizeObserver === "undefined") return;
    this.observer ??= new ResizeObserver(() => {
      if (this.state !== HoverPopoverState.Shown) return;
      this.resizeCount += 1;
      if (this.resizeCount >= 10) {
        this.disconnectResizeObserver();
        return;
      }
      this.position();
    });
    this.observer.observe(el);
  }

  override onunload(): void {
    if (this.state !== HoverPopoverState.Hidden) this.hide();
    this.disconnectResizeObserver();
  }

  private disconnectResizeObserver(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.resizeCount = 0;
  }
}

const pendingHoverPopovers: HoverPopover[] = [];
const shownHoverPopovers: HoverPopover[] = [];
let hoverPollingWindow: Window | null = null;
let hoverPollingInterval = 0;
let lastMouse: { x: number; y: number; doc: Document } | null = null;

function addPendingHover(popover: HoverPopover): void {
  removePendingHover(popover);
  pendingHoverPopovers.push(popover);
  ensureHoverPolling(getOwnerWindow(popover.hoverEl));
}

function removePendingHover(popover: HoverPopover): void {
  const index = pendingHoverPopovers.indexOf(popover);
  if (index !== -1) pendingHoverPopovers.splice(index, 1);
}

function addShownHover(popover: HoverPopover): void {
  removeShownHover(popover);
  shownHoverPopovers.push(popover);
  ensureHoverPolling(getOwnerWindow(popover.hoverEl));
}

function removeShownHover(popover: HoverPopover): void {
  const index = shownHoverPopovers.indexOf(popover);
  if (index !== -1) shownHoverPopovers.splice(index, 1);
}

function ensureHoverPolling(win: Window): void {
  if (hoverPollingInterval) return;
  hoverPollingWindow = win;
  win.addEventListener("click", closeDetachedHovers, { capture: true });
  win.addEventListener("contextmenu", closeDetachedHovers, { capture: true });
  win.addEventListener("mousemove", recordMousePosition);
  hoverPollingInterval = win.setInterval(pollHoverTargets, 500);
}

function stopHoverPollingIfIdle(): void {
  if (!hoverPollingWindow || pendingHoverPopovers.length > 0 || shownHoverPopovers.length > 0) return;
  hoverPollingWindow.removeEventListener("click", closeDetachedHovers, { capture: true });
  hoverPollingWindow.removeEventListener("contextmenu", closeDetachedHovers, { capture: true });
  hoverPollingWindow.removeEventListener("mousemove", recordMousePosition);
  hoverPollingWindow.clearInterval(hoverPollingInterval);
  hoverPollingWindow = null;
  hoverPollingInterval = 0;
  lastMouse = null;
}

function closeDetachedHovers(event: Event): void {
  for (const popover of [...pendingHoverPopovers]) popover.hide();
  const target = event.target instanceof Node ? event.target : null;
  const candidates = shownHoverPopovers.filter((popover) => {
    if (popover.isFocused) return false;
    if (target && popover.hoverEl.contains(target)) return false;
    if (target && popover.childHovers.some((child) => child.hoverEl.contains(target))) return false;
    return true;
  });
  const win = event.target instanceof Node ? event.target.ownerDocument.defaultView ?? window : getActiveWindow();
  win.setTimeout(() => {
    for (const popover of candidates) popover.hide();
  }, 5);
}

function recordMousePosition(event: MouseEvent): void {
  lastMouse = { x: event.clientX, y: event.clientY, doc: event.target instanceof Node ? event.target.ownerDocument : document };
}

function pollHoverTargets(): void {
  if (!lastMouse) return;
  const el = lastMouse.doc.elementFromPoint(lastMouse.x, lastMouse.y);
  for (const popover of shownHoverPopovers) popover.detect(el);
  for (const popover of [...shownHoverPopovers]) popover.transition();
  stopHoverPollingIfIdle();
}

function isHTMLElementLike(value: unknown): value is HTMLElement {
  return !!value && typeof value === "object" && "ownerDocument" in value && "classList" in value;
}

function isBoundaryMouseEvent(event: MouseEvent, el: HTMLElement): boolean {
  const related = event.relatedTarget;
  return !(related instanceof Node && el.contains(related));
}

function getOwnerWindow(el: Element): Window {
  return el.ownerDocument.defaultView ?? getActiveWindow();
}

export interface TooltipOptions {
  placement?: "bottom" | "top" | "left" | "right";
  classes?: string[];
  gap?: number;
  horizontalParent?: HTMLElement;
  delay?: number;
}

const DEFAULT_TOOLTIP_DELAY = 1000;
const FAST_TOOLTIP_DELAY = 100;
const DEFAULT_TOOLTIP_GAP = 8;
const TOP_TOOLTIP_OFFSET = 5;
const installedTooltipDocs = new WeakSet<Document>();
let activeTooltipEl: HTMLElement | null = null;
let activeTooltipTargetEl: HTMLElement | null = null;
let tooltipTimer: number | null = null;
let lastTooltipHide = 0;

export function displayTooltip(target: HTMLElement, text: string, options: TooltipOptions = {}): void {
  const delay = options.delay ?? 0;
  if (delay > 0 && (activeTooltipEl || Date.now() > lastTooltipHide + FAST_TOOLTIP_DELAY)) {
    clearTooltipTimer();
    const win = target.ownerDocument.defaultView ?? window;
    tooltipTimer = win.setTimeout(() => displayTooltip(target, text, { ...options, delay: 0 }), delay);
    return;
  }

  hideTooltip();
  if (!text) return;

  const doc = target.ownerDocument;
  const tooltipEl = doc.createElement("div");
  tooltipEl.className = "tooltip";
  for (const className of options.classes ?? []) tooltipEl.classList.add(className);
  const placement = options.placement ?? "bottom";
  if (placement === "left") tooltipEl.classList.add("mod-left");
  else if (placement === "right") tooltipEl.classList.add("mod-right");
  else if (placement === "top") tooltipEl.classList.add("mod-top");

  tooltipEl.textContent = text;
  const arrowEl = doc.createElement("div");
  arrowEl.className = "tooltip-arrow";
  tooltipEl.appendChild(arrowEl);
  doc.body.appendChild(tooltipEl);
  positionTooltip(target, tooltipEl, arrowEl, options);
  activeTooltipEl = tooltipEl;
  activeTooltipTargetEl = target;
}

export function setTooltip(target: HTMLElement, text: string, options: TooltipOptions = {}): void {
  target.setAttribute("aria-label", text);
  applyTooltipOptions(target, options);
  installTooltipListeners(target.ownerDocument);
  if (activeTooltipTargetEl === target) displayTooltip(target, text, options);
}

function installTooltipListeners(doc: Document): void {
  if (installedTooltipDocs.has(doc)) return;
  installedTooltipDocs.add(doc);
  doc.addEventListener("pointerover", handleTooltipPointerOver);
  doc.addEventListener("pointerout", handleTooltipPointerOut);
  doc.addEventListener("pointerup", hideTooltip);
}

function handleTooltipPointerOver(event: PointerEvent): void {
  const target = tooltipTargetFromEvent(event);
  if (!target || getComputedStyle(target).getPropertyValue("--no-tooltip").trim() === "true") return;
  const text = target.getAttribute("aria-label");
  if (!text) return;

  clearTooltipTimer();
  const options = tooltipOptionsFromTarget(target);
  const delay = Date.now() - lastTooltipHide < FAST_TOOLTIP_DELAY ? 0 : options.delay ?? DEFAULT_TOOLTIP_DELAY;
  if (delay <= 0) displayTooltip(target, text, options);
  else {
    const win = target.ownerDocument.defaultView ?? window;
    tooltipTimer = win.setTimeout(() => displayTooltip(target, text, options), delay);
  }
}

function handleTooltipPointerOut(event: PointerEvent): void {
  const target = tooltipTargetFromEvent(event);
  if (!target) return;
  const related = event.relatedTarget;
  if (related instanceof Node && target.contains(related)) return;
  hideTooltip();
}

function tooltipTargetFromEvent(event: Event): HTMLElement | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>("[aria-label]");
}

function tooltipOptionsFromTarget(target: HTMLElement): TooltipOptions {
  const placement = target.dataset.tooltipPosition;
  const classes = target.dataset.tooltipClasses?.split(/\s+/).filter(Boolean);
  const delay = target.dataset.tooltipDelay == null ? undefined : Number.parseInt(target.dataset.tooltipDelay, 10);
  return {
    placement: placement === "top" || placement === "left" || placement === "right" || placement === "bottom" ? placement : undefined,
    classes,
    delay: Number.isFinite(delay) ? delay : undefined,
  };
}

export function hideTooltip(): void {
  clearTooltipTimer();
  activeTooltipEl?.remove();
  activeTooltipEl = null;
  activeTooltipTargetEl = null;
  lastTooltipHide = Date.now();
}

function clearTooltipTimer(): void {
  if (tooltipTimer == null) return;
  window.clearTimeout(tooltipTimer);
  tooltipTimer = null;
}

function applyTooltipOptions(target: HTMLElement, options: TooltipOptions): void {
  if (options.placement && options.placement !== "bottom") target.setAttribute("data-tooltip-position", options.placement);
  if (options.classes) target.setAttribute("data-tooltip-classes", options.classes.join(" "));
  if (options.delay) target.setAttribute("data-tooltip-delay", String(options.delay));
}

function positionTooltip(target: HTMLElement, tooltipEl: HTMLElement, arrowEl: HTMLElement, options: TooltipOptions): void {
  const doc = target.ownerDocument;
  const body = doc.body;
  const win = doc.defaultView ?? window;
  const targetRect = target.getBoundingClientRect();
  const horizontalRect = options.horizontalParent?.getBoundingClientRect() ?? targetRect;
  const gap = options.gap ?? DEFAULT_TOOLTIP_GAP;
  const placement = options.placement ?? "bottom";
  const tooltipRect = tooltipEl.getBoundingClientRect();
  const width = tooltipRect.width || tooltipEl.offsetWidth || 1;
  const height = tooltipRect.height || tooltipEl.offsetHeight || 1;
  const viewportWidth = body.clientWidth || win.innerWidth;
  const viewportHeight = body.clientHeight || win.innerHeight;
  let left = horizontalRect.left + horizontalRect.width / 2 - width / 2;
  let top = targetRect.bottom + gap;

  if (placement === "top") top = targetRect.top - height - gap - TOP_TOOLTIP_OFFSET;
  else if (placement === "left") {
    left = targetRect.left - width - gap;
    top = targetRect.top + targetRect.height / 2 - height / 2;
  } else if (placement === "right") {
    left = targetRect.right + gap;
    top = targetRect.top + targetRect.height / 2 - height / 2;
  }

  const clampedLeft = clamp(left, 0, Math.max(0, viewportWidth - width));
  const clampedTop = clamp(top, 0, Math.max(0, viewportHeight - height));
  tooltipEl.style.position = "fixed";
  tooltipEl.style.left = `${clampedLeft}px`;
  tooltipEl.style.top = `${clampedTop}px`;

  const targetCenter = targetRect.left + targetRect.width / 2;
  const arrowLeft = clamp(targetCenter - clampedLeft, 0, width);
  arrowEl.style.left = `${arrowLeft}px`;
  arrowEl.style.right = "";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface RectLike {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function pointRect(pos: { x: number; y: number }): RectLike {
  return {
    top: pos.y - 10,
    bottom: pos.y + 10,
    left: pos.x,
    right: pos.x,
  };
}

function projectRectToTopWindow(rect: RectLike, win: Window): { rect: RectLike; win: Window } {
  const frameInfo = getFrameInfo(win);
  if (!frameInfo) return { rect, win };
  const projected = {
    left: rect.left * frameInfo.scale + frameInfo.x,
    right: rect.right * frameInfo.scale + frameInfo.x,
    top: rect.top * frameInfo.scale + frameInfo.y,
    bottom: rect.bottom * frameInfo.scale + frameInfo.y,
  };
  return { rect: projected, win: frameInfo.win };
}

function getFrameInfo(win: Window): { scale: number; x: number; y: number; win: Window } | null {
  let current = win;
  let scale = 1;
  let x = 0;
  let y = 0;
  while (current.frameElement instanceof HTMLElement) {
    const frame = current.frameElement;
    const rect = frame.getBoundingClientRect();
    const frameScale = frame.clientWidth ? rect.width / frame.clientWidth : 1;
    scale *= frameScale;
    x = x * frameScale + rect.x;
    y = y * frameScale + rect.y;
    if (!current.parent || current.parent === current) break;
    current = current.parent;
  }
  return current === win ? null : { scale, x, y, win: current };
}
