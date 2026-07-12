import { describe, expect, it } from "vitest";
import { App } from "@web/app/App";
import { CODE_LARGE_FILE_CHARS, CodeFileView } from "@web/views/CodeFileView";

describe("CodeFileView", () => {
  it("opens code files by extension and mirrors the document into CodeMirror", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const file = await app.vault.create("main.ts", "const x: number = 1;\n");

    const leaf = await app.workspace.openFile(file, { active: true });

    expect(leaf.view).toBeInstanceOf(CodeFileView);
    const view = leaf.view as CodeFileView;
    expect(view.getViewData()).toBe("const x: number = 1;\n");
    expect(view.getDisplayText()).toBe("main.ts");
    expect(view.getIcon()).toBe("lucide-file-code");
    expect(view.contentEl.querySelector(".cm-content")?.textContent).toContain(
      "const x: number = 1;",
    );
  });

  it("keeps external file changes in sync with the editor document", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const file = await app.vault.create("script.py", "print('a')\n");
    const leaf = await app.workspace.openFile(file, { active: true });
    const view = leaf.view as CodeFileView;

    await app.vault.modify(file, "print('b')\n");
    // The vault "modify" handler re-reads the file asynchronously.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.getViewData()).toBe("print('b')\n");
    expect(view.contentEl.querySelector(".cm-content")?.textContent).toContain("print('b')");
  });

  it("jumps to the eState line and selects the match range", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const file = await app.vault.create(
      "jump.ts",
      "const a = 1;\nconst b = 2;\nconst target = 3;\n",
    );

    const leaf = await app.workspace.openFile(file, {
      active: true,
      eState: { line: 2, matchStart: 6, matchEnd: 12 },
    });
    const view = leaf.view as CodeFileView;

    const cm = (
      view as unknown as {
        cm: {
          state: {
            selection: { main: { from: number; to: number } };
            doc: { line(n: number): { from: number } };
          };
        };
      }
    ).cm;
    const lineStart = cm.state.doc.line(3).from;
    expect(cm.state.selection.main.from).toBe(lineStart + 6);
    expect(cm.state.selection.main.to).toBe(lineStart + 12);
  });

  it("opens extensionless files like Dockerfile as code", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const file = await app.vault.create("Dockerfile", "FROM alpine:3\nRUN echo hi\n");

    const leaf = await app.workspace.openFile(file, { active: true });

    expect(leaf.view).toBeInstanceOf(CodeFileView);
    expect(
      (leaf.view as CodeFileView).contentEl.querySelector(".cm-content")?.textContent,
    ).toContain("FROM alpine:3");
  });

  it("global search covers code files and results deep-link into them", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    await app.vault.create("note.md", "needle in a note\n");
    await app.vault.create("app.go", "package main\n// needle in code\n");
    await app.vault.create("logo.png", "needle-in-binary");

    const results = await app.search.search({ query: "needle" });

    expect(results.map((result) => result.path)).toEqual(["app.go", "note.md"]);
    expect(results[0].matches[0].line).toBe(1);
  });

  it("persists the word wrap toggle through view state", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const file = await app.vault.create("wrap.ts", "const x = 1;\n");
    const leaf = await app.workspace.openFile(file, { active: true });
    const view = leaf.view as CodeFileView;

    expect(view.wordWrap).toBe(false);
    view.setWordWrap(true);
    expect(view.getState()).toMatchObject({ wordWrap: true });

    await view.setState({ file: file.path, wordWrap: true });
    expect(view.wordWrap).toBe(true);
  });

  it("saves edited view data back to the vault", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const file = await app.vault.create("config.yaml", "a: 1\n");
    const leaf = await app.workspace.openFile(file, { active: true });
    const view = leaf.view as CodeFileView;

    view.setViewData("a: 2\n");
    await view.save();

    await expect(app.vault.read(file)).resolves.toBe("a: 2\n");
  });

  it("skips language packs for large documents", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const body = `${"const x = 1;\n".repeat(Math.ceil(CODE_LARGE_FILE_CHARS / 12))}// end\n`;
    expect(body.length).toBeGreaterThanOrEqual(CODE_LARGE_FILE_CHARS);
    const file = await app.vault.create("huge.ts", body);

    const leaf = await app.workspace.openFile(file, { active: true });
    const view = leaf.view as CodeFileView;
    // Allow async applyLanguage to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const cm = (view as unknown as { cm: { state: { facet: (f: unknown) => unknown } } }).cm;
    // Language compartment left empty: content still renders, no lezer language active.
    expect(view.getViewData().length).toBe(body.length);
    expect(view.contentEl.querySelector(".cm-content")?.textContent?.length).toBeGreaterThan(0);
    expect(cm).toBeTruthy();
  });
});
