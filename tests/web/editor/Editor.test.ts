import { describe, expect, it } from "vitest";
import { Editor, SimpleEditor } from "@web/editor/Editor";

describe("SimpleEditor", () => {
  it("supports Obsidian-style text ranges, selections, and position conversion", () => {
    const editor = new SimpleEditor();
    editor.setValue("alpha\nbeta\ngamma");

    expect(editor).toBeInstanceOf(Editor);
    expect(editor.getDoc()).toBe(editor);
    expect(editor.lineCount()).toBe(3);
    expect(editor.lastLine()).toBe(2);
    expect(editor.getLine(1)).toBe("beta");
    expect(editor.getRange({ line: 0, ch: 1 }, { line: 1, ch: 2 })).toBe("lpha\nbe");
    expect(editor.posToOffset({ line: 2, ch: 2 })).toBe(13);
    expect(editor.offsetToPos(13)).toEqual({ line: 2, ch: 2 });

    editor.setSelection({ line: 0, ch: 1 }, { line: 0, ch: 4 });

    expect(editor.getSelection()).toBe("lph");
    expect(editor.somethingSelected()).toBe(true);
    expect(editor.getCursor("from")).toEqual({ line: 0, ch: 1 });
    expect(editor.getCursor("to")).toEqual({ line: 0, ch: 4 });
    expect(editor.listSelections()).toEqual([
      { anchor: { line: 0, ch: 1 }, head: { line: 0, ch: 4 } },
    ]);

    editor.replaceSelection("X");

    expect(editor.getValue()).toBe("aXa\nbeta\ngamma");
    expect(editor.getCursor()).toEqual({ line: 0, ch: 2 });
  });

  it("supports replaceRange, transactions, line processing, focus, scroll, and wordAt", () => {
    const editor = new SimpleEditor();
    editor.setValue("one\ntwo\nthree");

    editor.replaceRange("TWO", { line: 1, ch: 0 }, { line: 1, ch: 3 });
    expect(editor.getValue()).toBe("one\nTWO\nthree");

    editor.transaction({
      changes: [
        { from: { line: 0, ch: 0 }, to: { line: 0, ch: 3 }, text: "ONE" },
        { from: { line: 2, ch: 0 }, to: { line: 2, ch: 5 }, text: "THREE" },
      ],
      selection: { from: { line: 1, ch: 1 }, to: { line: 1, ch: 3 } },
    });

    expect(editor.getValue()).toBe("ONE\nTWO\nTHREE");
    expect(editor.getSelection()).toBe("WO");
    expect(editor.wordAt({ line: 2, ch: 2 })).toEqual({
      from: { line: 2, ch: 0 },
      to: { line: 2, ch: 5 },
    });

    editor.processLines(
      (_line, text) => text.toLowerCase(),
      (line, _text, value) => ({
        from: { line, ch: 0 },
        to: { line, ch: editor.getLine(line).length },
        text: value ?? "",
      }),
    );

    expect(editor.getValue()).toBe("one\ntwo\nthree");

    editor.focus();
    editor.scrollTo(4, 8);
    editor.exec("goEnd");

    expect(editor.hasFocus()).toBe(true);
    expect(editor.getScrollInfo()).toMatchObject({ left: 4, top: 8 });
    expect(editor.getCursor()).toEqual({ line: 2, ch: 5 });

    editor.blur();
    expect(editor.hasFocus()).toBe(false);
  });

  it("notifies document changes once per public mutation", () => {
    const editor = new SimpleEditor();
    const changes: Array<{ value: string; origin?: string }> = [];
    editor.onChange((changedEditor, origin) => {
      changes.push({ value: changedEditor.getValue(), ...(origin ? { origin } : {}) });
    });
    editor.setValue("one");
    editor.replaceRange("two", { line: 0, ch: 0 }, { line: 0, ch: 3 }, "+input");
    editor.transaction(
      {
        changes: [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 3 }, text: "three" }],
        selection: { from: { line: 0, ch: 5 } },
      },
      "+plugin",
    );

    expect(changes).toEqual([
      { value: "one" },
      { value: "two", origin: "+input" },
      { value: "three", origin: "+plugin" },
    ]);
  });

  it("notifies selection changes once per public selection mutation", () => {
    const editor = new SimpleEditor();
    const selections: Array<ReturnType<SimpleEditor["listSelections"]>> = [];
    editor.setValue("alpha\nbeta");
    editor.onSelectionChange((changedEditor) => {
      selections.push(changedEditor.listSelections());
    });

    editor.setCursor({ line: 1, ch: 2 });
    editor.setSelection({ line: 0, ch: 1 }, { line: 0, ch: 4 });
    editor.transaction({ selection: { from: { line: 1, ch: 0 }, to: { line: 1, ch: 4 } } });

    expect(selections).toEqual([
      [{ anchor: { line: 1, ch: 2 }, head: { line: 1, ch: 2 } }],
      [{ anchor: { line: 0, ch: 1 }, head: { line: 0, ch: 4 } }],
      [{ anchor: { line: 1, ch: 0 }, head: { line: 1, ch: 4 } }],
    ]);
  });
});
