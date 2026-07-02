import { describe, expect, it } from "vitest";
import { getMarkdown, parseMarkdownToStructure } from "stream-markdown-parser";
import { Component } from "../core/Component";
import { StreamMarkdownRenderer } from "./StreamMarkdownRenderer";

function setup() {
  const owner = new Component();
  owner.load();
  const containerEl = document.createElement("div");
  document.body.appendChild(containerEl);
  const renderer = new StreamMarkdownRenderer(containerEl, owner);
  const md = getMarkdown("test-message");
  return { owner, containerEl, renderer, md };
}

describe("StreamMarkdownRenderer", () => {
  it("renders headings, tables and code fences from parsed nodes", () => {
    const { containerEl, renderer, md } = setup();
    const markdown = "# Title\n\nSome **bold** and `code`.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```\n";
    renderer.update(parseMarkdownToStructure(markdown, md, { final: true }));

    expect(containerEl.querySelector("h1")?.textContent).toBe("Title");
    expect(containerEl.querySelector("p strong")?.textContent).toBe("bold");
    expect(containerEl.querySelector("p code")?.textContent).toBe("code");
    expect(containerEl.querySelectorAll("table td")).toHaveLength(2);
    expect(containerEl.querySelector("pre code")?.textContent).toContain("const x = 1;");
    expect(containerEl.querySelector("pre code")?.className).toContain("language-ts");
  });

  it("only re-renders the tail as the stream grows", () => {
    const { containerEl, renderer, md } = setup();
    renderer.update(parseMarkdownToStructure("first paragraph\n\nsecond gro", md));
    const stableEl = containerEl.children[0];
    const growingEl = containerEl.children[1];

    renderer.update(parseMarkdownToStructure("first paragraph\n\nsecond grows longer", md));
    expect(containerEl.children[0]).toBe(stableEl);
    expect(containerEl.children[1]).not.toBe(growingEl);
    expect(containerEl.children[1].textContent).toContain("second grows longer");
  });

  it("marks growing fenced blocks as loading, then settles them on final parse", () => {
    const { containerEl, renderer, md } = setup();
    renderer.update(parseMarkdownToStructure("```ts\nconst a =", md));
    expect(containerEl.querySelector(".is-loading")).not.toBeNull();

    renderer.update(parseMarkdownToStructure("```ts\nconst a = 1;\n```\n", md, { final: true }));
    expect(containerEl.querySelector(".is-loading")).toBeNull();
    expect(containerEl.querySelector("pre code")?.textContent).toContain("const a = 1;");
  });

  it("unloads render children for replaced tail nodes", () => {
    const { owner, renderer, md } = setup();
    renderer.update(parseMarkdownToStructure("one\n\ntwo", md));
    const childCount = owner._children.length;

    renderer.update(parseMarkdownToStructure("one\n\ntwo more", md));
    expect(owner._children.length).toBe(childCount);

    renderer.clear();
    expect(owner._children.length).toBe(0);
  });
});
