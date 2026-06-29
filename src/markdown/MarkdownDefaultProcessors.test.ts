import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../app/App";
import { Component } from "../core/Component";
import { MarkdownRenderer } from "./MarkdownRenderer";

describe("Markdown default processors", () => {
  beforeEach(() => {
    Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
    delete (globalThis as { mermaid?: unknown }).mermaid;
  });

  it("renders math and mermaid code blocks through the public helper pipeline", async () => {
    const app = new App(document.createElement("div"));
    const owner = new Component();
    const container = document.createElement("div");

    await MarkdownRenderer.render(app, "```math\nx^2\n```\n\n```mermaid\ngraph TD; A-->B;\n```", container, "Note.md", owner);

    expect(container.querySelector(".block-language-math .math.math-block")?.textContent).toBe("x^2");
    const mermaid = container.querySelector<HTMLElement>(".block-language-mermaid.mermaid");
    expect(mermaid?.querySelector("svg")?.getAttribute("data-mermaid-source")).toBe("graph TD; A-->B;");
    expect(container.textContent).not.toContain("placeholder");
  });
});
