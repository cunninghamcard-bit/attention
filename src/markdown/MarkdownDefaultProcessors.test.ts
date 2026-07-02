import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { Component } from "../core/Component";
import { addCopyCodeButtons } from "./MarkdownDefaultProcessors";
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

  it("adds a copy button to rendered code fences, like Obsidian's reading view", async () => {
    const app = new App(document.createElement("div"));
    const owner = new Component();
    const container = document.createElement("div");

    await MarkdownRenderer.render(app, "```ts\nconst a = 1;\n```", container, "Note.md", owner);
    expect(container.querySelectorAll(".copy-code-button")).toHaveLength(1);
  });

  it("copies the fence source and stays idempotent", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const root = document.createElement("div");
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = "const a = 1;";
    pre.appendChild(code);
    root.appendChild(pre);

    addCopyCodeButtons(root);
    addCopyCodeButtons(root);
    expect(root.querySelectorAll(".copy-code-button")).toHaveLength(1);

    (root.querySelector(".copy-code-button") as HTMLButtonElement).click();
    expect(writeText).toHaveBeenCalledWith("const a = 1;");
  });
});
