import { afterEach, describe, expect, it, vi } from "vitest";

import { Notice } from "@web/ui/Notice";

describe("Notice DOM parity", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll(".notice-container").forEach((containerEl) => {
      containerEl.replaceChildren();
      containerEl.remove();
    });
  });

  it("uses Obsidian's notice-container > notice > notice-message ownership", () => {
    const notice = new Notice("Loaded", 0);
    const noticesEl = document.body.querySelector<HTMLElement>(".notice-container");

    expect(noticesEl).not.toBeNull();
    expect(notice.noticesEl).toBe(noticesEl);
    expect(notice.containerEl.className).toBe("notice");
    expect(notice.noticeEl).toBe(notice.messageEl);
    expect(notice.messageEl.className).toBe("notice-message");
    expect(notice.messageEl.textContent).toBe("Loaded");
    expect([...notice.noticesEl.children]).toEqual([notice.containerEl]);
    expect([...notice.containerEl.children]).toEqual([notice.messageEl]);
  });

  it("uses Obsidian text semantics for constructor and setMessage values", () => {
    const initial = document.createDocumentFragment();
    const strong = document.createElement("strong");
    strong.textContent = "Fragment";
    initial.appendChild(strong);
    const notice = new Notice(initial, 0);

    // Real Obsidian appends fragment DOM (does not flatten to text).
    expect(notice.messageEl.textContent).toBe("Fragment");
    expect(notice.messageEl.querySelector("strong")).not.toBeNull();

    // A string replaces the DOM with plain text.
    expect(notice.setMessage("Reset")).toBe(notice);
    expect(notice.messageEl.textContent).toBe("Reset");
    expect(notice.messageEl.children).toHaveLength(0);

    const next = document.createDocumentFragment();
    const em = document.createElement("em");
    em.textContent = "Next";
    next.appendChild(em);

    expect(notice.setMessage(next)).toBe(notice);
    expect(notice.messageEl.textContent).toBe("Next");
    expect(notice.messageEl.querySelector("em")).not.toBeNull();
  });

  it("adds CTA buttons inside a notice button container and hides on click", () => {
    const notice = new Notice("Saved", 0);
    const callback = vi.fn();

    notice.addButton("Undo", callback);
    const buttonContainerEl = notice.containerEl.querySelector<HTMLElement>(".notice-button-container");
    const buttonEl = buttonContainerEl?.querySelector<HTMLElement>(".notice-cta");

    expect(buttonContainerEl?.parentElement).toBe(notice.containerEl);
    expect(buttonEl?.textContent).toBe("Undo");

    buttonEl?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(callback).toHaveBeenCalledTimes(1);
    expect(notice.containerEl.parentElement).toBeNull();
    expect(notice.noticesEl.parentElement).toBeNull();
  });

  it("shares one outer container per window and removes it after the final notice", () => {
    const first = new Notice("First", 0);
    const second = new Notice("Second", 0);

    expect(first.noticesEl).toBe(second.noticesEl);
    expect([...first.noticesEl.children]).toEqual([first.containerEl, second.containerEl]);

    first.hide();

    expect(second.noticesEl.parentElement).toBe(document.body);
    expect([...second.noticesEl.children]).toEqual([second.containerEl]);

    second.hide();

    expect(second.noticesEl.parentElement).toBeNull();
  });

  it("hides on direct click and keeps duration zero notices visible", () => {
    vi.useFakeTimers();
    const notice = new Notice("Manual", 0);

    vi.advanceTimersByTime(10_000);
    expect(notice.containerEl.parentElement).toBe(notice.noticesEl);

    notice.containerEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(notice.containerEl.parentElement).toBeNull();
  });

  it("auto hides after the configured duration", () => {
    vi.useFakeTimers();
    const notice = new Notice("Timed", 50);

    vi.advanceTimersByTime(49);
    expect(notice.containerEl.parentElement).toBe(notice.noticesEl);

    vi.advanceTimersByTime(1);

    expect(notice.containerEl.parentElement).toBeNull();
  });

  it("pauses auto hide while hovered and retries one second after leaving", () => {
    vi.useFakeTimers();
    const notice = new Notice("Hover", 50);

    notice.containerEl.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(50);

    expect(notice.containerEl.parentElement).toBe(notice.noticesEl);

    notice.containerEl.dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(999);

    expect(notice.containerEl.parentElement).toBe(notice.noticesEl);

    vi.advanceTimersByTime(1);

    expect(notice.containerEl.parentElement).toBeNull();
  });
});
