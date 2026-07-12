import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { displayTooltip, HoverPopover, PopoverState, setTooltip } from "@web/ui/Popover";

let dom: JSDOM | null = null;

beforeEach(() => {
  dom = new JSDOM("<!doctype html><html><body><button id=\"target\">Target</button><div id=\"parent\"></div></body></html>", { pretendToBeVisual: true });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Element", dom.window.Element);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  Object.defineProperty(document.body, "clientWidth", { configurable: true, value: 800 });
  Object.defineProperty(document.body, "clientHeight", { configurable: true, value: 600 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  dom?.window.close();
  dom = null;
});

function targetEl(): HTMLElement {
  const target = document.querySelector<HTMLElement>("#target");
  if (!target) throw new Error("missing target");
  Object.defineProperty(target, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 100, right: 180, top: 50, bottom: 70, width: 80, height: 20 }),
  });
  return target;
}

describe("tooltip API parity", () => {
  it("displayTooltip appends tooltip and arrow to the document body", () => {
    const target = targetEl();

    displayTooltip(target, "Open settings", { placement: "top", classes: ["mod-wide"], gap: 12 });

    const tooltipEl = document.body.querySelector<HTMLElement>(".tooltip");

    expect(tooltipEl?.parentElement).toBe(document.body);
    expect(target.querySelector(".tooltip")).toBeNull();
    expect(tooltipEl?.textContent).toBe("Open settings");
    expect(tooltipEl?.classList.contains("mod-top")).toBe(true);
    expect(tooltipEl?.classList.contains("mod-wide")).toBe(true);
    expect(tooltipEl?.querySelector(".tooltip-arrow")).not.toBeNull();
  });

  it("displayTooltip honors direct delay options", () => {
    vi.useFakeTimers();
    vi.setSystemTime(9_000_000_000_000);
    const target = targetEl();

    displayTooltip(target, "Delayed", { delay: 25 });

    expect(document.body.querySelector(".tooltip")).toBeNull();

    vi.advanceTimersByTime(25);

    expect(document.body.querySelector(".tooltip")?.textContent).toBe("Delayed");
  });

  it("setTooltip writes Obsidian tooltip attributes", () => {
    const target = targetEl();

    setTooltip(target, "Donate", { placement: "right", classes: ["mod-accent", "mod-small"], delay: 25 });

    expect(target.getAttribute("aria-label")).toBe("Donate");
    expect(target.dataset.tooltipPosition).toBe("right");
    expect(target.dataset.tooltipClasses).toBe("mod-accent mod-small");
    expect(target.dataset.tooltipDelay).toBe("25");
    expect(target.title).toBe("");
  });

  it("does not write default bottom placement or falsy delay attributes", () => {
    const target = targetEl();

    setTooltip(target, "Bottom", { placement: "bottom", delay: 0 });

    expect(target.getAttribute("aria-label")).toBe("Bottom");
    expect(target.hasAttribute("data-tooltip-position")).toBe(false);
    expect(target.hasAttribute("data-tooltip-delay")).toBe(false);
  });

  it("shows and hides tooltips through the aria-label hover protocol", () => {
    vi.useFakeTimers();
    vi.setSystemTime(9_000_000_000_000);
    const target = targetEl();
    setTooltip(target, "Hotkeys", { placement: "left", delay: 25 });

    target.dispatchEvent(new Event("pointerover", { bubbles: true }));

    expect(document.body.querySelector(".tooltip")).toBeNull();

    vi.advanceTimersByTime(25);

    expect(document.body.querySelector(".tooltip.mod-left")?.textContent).toBe("Hotkeys");

    target.dispatchEvent(new Event("pointerout", { bubbles: true }));

    expect(document.body.querySelector(".tooltip")).toBeNull();
  });
});

describe("HoverPopover API parity", () => {
  class RecordingHoverPopover extends HoverPopover {
    shown = 0;
    hidden = 0;
    loaded = 0;
    unloaded = 0;

    override onShow(): void {
      super.onShow();
      this.shown += 1;
    }

    override onHide(): void {
      this.hidden += 1;
    }

    override onload(): void {
      this.loaded += 1;
    }

    override onunload(): void {
      this.unloaded += 1;
      super.onunload();
    }
  }

  it("claims the parent and loads only after the show timer", () => {
    vi.useFakeTimers();
    const parent = { hoverPopover: null as HoverPopover | null };
    const target = targetEl();
    const popover = new RecordingHoverPopover(parent, target, 25, { x: 10, y: 20 });

    expect(popover.state).toBe(PopoverState.Showing);
    expect(parent.hoverPopover).toBeNull();
    expect(popover.contentEl).toBe(popover.hoverEl);
    expect(popover.hoverEl.querySelector(".popover-content")).toBeNull();
    expect(popover.loaded).toBe(0);

    vi.advanceTimersByTime(25);

    expect(popover.state).toBe(PopoverState.Shown);
    expect(parent.hoverPopover).toBe(popover);
    expect(popover.hoverEl.isConnected).toBe(true);
    expect(popover.shown).toBe(1);
    expect(popover.loaded).toBe(1);

    popover.hide();

    expect(popover.state).toBe(PopoverState.Hidden);
    expect(parent.hoverPopover).toBeNull();
    expect(popover.hidden).toBe(1);
    expect(popover.unloaded).toBe(1);
  });

  it("keeps a parent hover open while a child hover is active", () => {
    vi.useFakeTimers();
    const parentTarget = targetEl();
    const childTarget = document.createElement("button");
    const parent = { hoverPopover: null as HoverPopover | null };
    const childParent = { hoverPopover: null as HoverPopover | null };
    const parentPopover = new RecordingHoverPopover(parent, parentTarget, 0);

    vi.runOnlyPendingTimers();
    parentPopover.hoverEl.appendChild(childTarget);

    const childPopover = new RecordingHoverPopover(childParent, childTarget, 0);
    vi.runOnlyPendingTimers();

    parentTarget.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    parentPopover.transition();

    expect(childPopover.state).toBe(PopoverState.Shown);
    expect(parentPopover.state).toBe(PopoverState.Shown);

    childPopover.hide();
    parentPopover.transition();
    vi.advanceTimersByTime(parentPopover.waitTime);

    expect(parentPopover.state).toBe(PopoverState.Hidden);
  });
});
