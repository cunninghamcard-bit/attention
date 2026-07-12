import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { extractCodeSymbols } from "@web/views/CodeSymbols";

async function viewFor(filename: string, doc: string): Promise<EditorView> {
  const description = LanguageDescription.matchFilename(languages, filename);
  const support = await description!.load();
  return new EditorView({ state: EditorState.create({ doc, extensions: [support] }) });
}

describe("extractCodeSymbols", () => {
  it("extracts TypeScript functions, classes and methods with nesting", async () => {
    const view = await viewFor("a.ts", [
      "export function topLevel(): void {}",
      "",
      "class Engine {",
      "  start(): void {}",
      "}",
      "",
      "interface Config { url: string }",
    ].join("\n"));

    const symbols = extractCodeSymbols(view);
    expect(symbols).toContainEqual({ name: "topLevel", kind: "function", line: 0, depth: 0 });
    expect(symbols).toContainEqual({ name: "Engine", kind: "class", line: 2, depth: 0 });
    expect(symbols.find((s) => s.name === "start")).toMatchObject({ kind: "method", depth: 1 });
    expect(symbols.find((s) => s.name === "Config")).toMatchObject({ kind: "type" });
  });

  it("extracts Python functions and classes", async () => {
    const view = await viewFor("a.py", [
      "def top():",
      "    pass",
      "",
      "class Agent:",
      "    def run(self):",
      "        pass",
    ].join("\n"));

    const symbols = extractCodeSymbols(view);
    expect(symbols.find((s) => s.name === "top")).toMatchObject({ kind: "function", line: 0, depth: 0 });
    expect(symbols.find((s) => s.name === "Agent")).toMatchObject({ kind: "class", line: 3 });
    expect(symbols.find((s) => s.name === "run")).toMatchObject({ depth: 1 });
  });

  it("extracts Go functions", async () => {
    const view = await viewFor("a.go", [
      "package main",
      "",
      "func findNeedle() int { return 0 }",
      "",
      "type Server struct{}",
      "",
      "func (s *Server) Start() {}",
    ].join("\n"));

    const symbols = extractCodeSymbols(view);
    expect(symbols.find((s) => s.name === "findNeedle")).toMatchObject({ line: 2 });
    expect(symbols.find((s) => s.name === "Start")).toBeDefined();
  });
});
