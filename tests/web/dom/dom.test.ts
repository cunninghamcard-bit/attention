import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetActiveWindow, setActiveWindow } from "@web/dom/ActiveDocument";
import { createDiv, createEl, createSpan, detach, installDomExtensions, removeChildren } from "@web/dom/dom";

let dom: JSDOM | null = null;

beforeEach(() => {
  dom = new JSDOM("<!doctype html><html><body><section id=\"host\"><p id=\"first\"></p></section></body></html>");
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Element", dom.window.Element);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("Document", dom.window.Document);
  installDomExtensions(dom.window as Window & typeof globalThis);
  setActiveWindow(window);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetActiveWindow();
  dom?.window.close();
  dom = null;
});

function hostEl(): HTMLElement {
  const host = document.querySelector<HTMLElement>("#host");
  if (!host) throw new Error("missing host");
  return host;
}

describe("Obsidian DOM helpers", () => {
  it("supports createDiv object info, parent, prepend, and callback builder", () => {
    const host = hostEl();
    const child = createDiv({ parent: host, cls: ["callout", "mod-info"], text: "Info", attr: { contentEditable: false, "data-kind": "note" }, prepend: true }, (el) => {
      el.dataset.built = "true";
    });

    expect(host.firstElementChild).toBe(child);
    expect(child.className).toBe("callout mod-info");
    expect(child.textContent).toBe("Info");
    expect(child.getAttribute("contentEditable")).toBe("false");
    expect(child.dataset.kind).toBe("note");
    expect(child.dataset.built).toBe("true");
  });

  it("supports createEl/createSpan string classes and callback-only builders", () => {
    const button = createEl("button", "clickable-icon", (el) => {
      el.type = "button";
      el.setText("Run");
    });
    const span = createSpan({ cls: "suggestion-highlight", text: "match" });

    expect(button.className).toBe("clickable-icon");
    expect(button.textContent).toBe("Run");
    expect(span.outerHTML).toBe('<span class="suggestion-highlight">match</span>');
  });

  it("creates parentless elements in the active document", () => {
    const popoutDom = new JSDOM("<!doctype html><html><body></body></html>");
    installDomExtensions(popoutDom.window as Window & typeof globalThis);
    const mainHost = hostEl();
    const popoutHost = popoutDom.window.document.body.appendChild(popoutDom.window.document.createElement("section"));
    setActiveWindow(popoutDom.window as unknown as Window);

    const el = createDiv("workspace-tabs");
    const mainChild = createDiv("main-child", mainHost);
    const popoutChild = createDiv("popout-child", popoutHost);
    const helperChild = popoutHost.createDiv("helper-child");

    expect(el.ownerDocument).toBe(popoutDom.window.document);
    expect(mainChild.ownerDocument).toBe(document);
    expect(mainChild.parentElement).toBe(mainHost);
    expect(popoutChild.ownerDocument).toBe(popoutDom.window.document);
    expect(popoutChild.parentElement).toBe(popoutHost);
    expect(helperChild.ownerDocument).toBe(popoutDom.window.document);
    expect(helperChild.parentElement).toBe(popoutHost);

    setActiveWindow(window);
    popoutDom.window.close();
  });

  it("installs Node and Element prototype helpers", () => {
    const host = hostEl();
    const item = host.createDiv("item", (el) => {
      el.createSpan({ cls: "label", text: "Alpha" });
      el.appendText(" Beta");
    });

    item.addClass("is-active").toggleClass("is-selected", true).setAttr("data-path", "Notes/A.md");

    expect(item.hasClass("is-active")).toBe(true);
    expect(item.hasClass("is-selected")).toBe(true);
    expect(item.getAttr("data-path")).toBe("Notes/A.md");
    expect(item.find(".label")?.textContent).toBe("Alpha");
    expect(item.textContent).toBe("Alpha Beta");
    expect(item.doc).toBe(document);
    expect(item.win).toBe(window);

    item.empty();
    expect(item.childNodes).toHaveLength(0);
    item.detach();
    expect(item.parentElement).toBeNull();
  });

  it("supports delegated events and onClickEvent cleanup", () => {
    const host = hostEl();
    const button = host.createEl("button", { cls: "action", text: "Click" });
    const delegated = vi.fn();
    const clicked = vi.fn();
    const offDelegated = host.on("click", ".action", delegated);
    const offClick = button.onClickEvent(clicked);

    button.click();

    expect(delegated.mock.calls[0]?.[0]).toBeDefined();
    expect(delegated.mock.calls[0]?.[1]).toBe(button);
    expect(clicked).toHaveBeenCalledTimes(1);

    offDelegated();
    offClick();
    button.click();

    expect(delegated).toHaveBeenCalledTimes(1);
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("supports onNodeInserted cleanup", async () => {
    const host = hostEl();
    const child = createDiv("deferred-target");
    const inserted = vi.fn();
    const cleanup = child.onNodeInserted(inserted);

    host.appendChild(child);
    await Promise.resolve();

    expect(inserted).toHaveBeenCalledTimes(1);

    cleanup();
    child.detach();
    host.appendChild(child);
    await Promise.resolve();

    expect(inserted).toHaveBeenCalledTimes(1);
  });

  it("keeps detach and removeChildren function helpers", () => {
    const host = hostEl();
    const child = createDiv("child", host);

    expect(host.contains(child)).toBe(true);
    detach(child);
    expect(host.contains(child)).toBe(false);

    host.append(createSpan("a"), createSpan("b"));
    removeChildren(host);
    expect(host.childNodes).toHaveLength(0);
  });
});
