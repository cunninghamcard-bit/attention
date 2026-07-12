import { describe, expect, it } from "vitest";
import { App } from "@web/app/App";

describe("Workspace iterateCodeMirrors parity", () => {
  it("exposes the legacy no-op CodeMirror iterator", () => {
    const app = new App(document.createElement("div"));
    const visited: unknown[] = [];

    expect(() => app.workspace.iterateCodeMirrors((codeMirror) => visited.push(codeMirror))).not.toThrow();
    expect(visited).toEqual([]);
  });
});
