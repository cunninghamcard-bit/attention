import { beforeAll, describe, expect, it } from "vitest";
import { createFragment, installDomExtensions } from "./dom";

beforeAll(() => installDomExtensions(window));

describe("DOM prototype helpers (real Obsidian surface)", () => {
  it("setCssStyles assigns multiple style properties", () => {
    const el = document.createElement("div");
    el.setCssStyles({ position: "absolute", top: "5px" });
    expect(el.style.position).toBe("absolute");
    expect(el.style.top).toBe("5px");
  });

  it("setCssProps sets custom CSS variables", () => {
    const el = document.createElement("div");
    el.setCssProps({ "--foo": "10px", "--bar": "red" });
    expect(el.style.getPropertyValue("--foo")).toBe("10px");
    expect(el.style.getPropertyValue("--bar")).toBe("red");
  });

  it("toggleVisibility flips visibility without touching display", () => {
    const el = document.createElement("div");
    el.toggleVisibility(false);
    expect(el.style.visibility).toBe("hidden");
    el.toggleVisibility(true);
    expect(el.style.visibility).toBe("");
    expect(el.style.display).toBe("");
  });

  it("getText returns textContent or empty string", () => {
    const el = document.createElement("div");
    expect(el.getText()).toBe("");
    el.textContent = "hello";
    expect(el.getText()).toBe("hello");
  });

  it("insertAfter places a node after a reference (or first when null)", () => {
    const parent = document.createElement("div");
    const a = document.createElement("span");
    const b = document.createElement("span");
    parent.append(a);
    const inserted = parent.insertAfter(b, a);
    expect(inserted).toBe(b);
    expect(parent.childNodes[1]).toBe(b);

    const c = document.createElement("span");
    parent.insertAfter(c, null);
    expect(parent.firstChild).toBe(c);
  });

  it("createFragment builds a fragment and runs the builder callback", () => {
    const frag = createFragment((f) => {
      f.createDiv({ cls: "x" });
      f.createSpan();
    });
    expect(frag).toBeInstanceOf(DocumentFragment);
    expect(frag.querySelector("div.x")).not.toBeNull();
    expect(frag.querySelector("span")).not.toBeNull();
  });
});
