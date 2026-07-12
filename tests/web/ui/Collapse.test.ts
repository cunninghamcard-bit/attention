import { describe, expect, it } from "vitest";
import { Collapse } from "@web/ui/Collapse";

function setup() {
  const rootEl = document.createElement("div");
  document.body.appendChild(rootEl);
  const collapse = new Collapse(rootEl, { header: "x-header", clip: "x-clip", body: "x-body" });
  return { rootEl, collapse };
}

describe("Collapse", () => {
  it("builds header + clip > body and toggles is-collapsed on the root", () => {
    const { rootEl, collapse } = setup();
    expect(rootEl.querySelector(":scope > .x-header")).toBe(collapse.headerEl);
    expect(rootEl.querySelector(":scope > .x-clip > .x-body")).toBe(collapse.bodyEl);

    collapse.setCollapsed(true);
    expect(rootEl.classList.contains("is-collapsed")).toBe(true);
    collapse.setCollapsed(false);
    expect(rootEl.classList.contains("is-collapsed")).toBe(false);
  });

  it("a header click toggles and marks userToggled, so auto-collapse can defer", () => {
    const { rootEl, collapse } = setup();
    expect(collapse.userToggled).toBe(false);
    collapse.headerEl.click();
    expect(collapse.userToggled).toBe(true);
    expect(rootEl.classList.contains("is-collapsed")).toBe(true);
    collapse.headerEl.click();
    expect(rootEl.classList.contains("is-collapsed")).toBe(false);
  });
});
