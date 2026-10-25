/**
 * Input: @web/builtin/language-server/LanguageServerRegistry, @web/builtin/language-server/LanguageUri, @web/views/CodeFileView
 * Output: test suite
 * Pos: Test code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { describe, expect, it } from "vitest";
import {
  LANGUAGE_GROUPS,
  LANGUAGE_SERVERS,
  getLanguageServer,
  languageForExtension,
} from "@web/builtin/language-server/LanguageServerRegistry";
import {
  normalizeLocations,
  normalizeUri,
  pathToUri,
  uriToPath,
} from "@web/builtin/language-server/LanguageUri";
import { CODE_EXTENSIONS } from "@web/views/CodeFileView";

describe("language server table", () => {
  it("names only servers that exist, each once", () => {
    const ids = LANGUAGE_SERVERS.map((server) => server.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const group of LANGUAGE_GROUPS) {
      expect(group.servers.length).toBeGreaterThan(0);
      for (const id of group.servers) expect(getLanguageServer(id), id).not.toBeNull();
    }
  });

  it("serves only extensions the code view opens", () => {
    // A language here that the workspace opens in some other view would start
    // a server no editor can use.
    for (const group of LANGUAGE_GROUPS) {
      for (const extension of Object.keys(group.extensions)) {
        expect(CODE_EXTENSIONS, `${group.id}: .${extension}`).toContain(extension);
      }
    }
  });

  it("maps an extension to its language id, case-insensitively", () => {
    expect(languageForExtension("py")).toMatchObject({ languageId: "python" });
    expect(languageForExtension("TSX")).toMatchObject({ languageId: "typescriptreact" });
    expect(languageForExtension("md")).toBeNull();
  });
});

describe("document URIs", () => {
  it("round-trips paths with spaces and non-ASCII names", () => {
    const path = "/Users/me/my repo/源码/a b.py";
    expect(pathToUri(path)).toBe("file:///Users/me/my%20repo/%E6%BA%90%E7%A0%81/a%20b.py");
    expect(uriToPath(pathToUri(path))).toBe(path);
  });

  it("handles Windows drive paths", () => {
    expect(pathToUri("C:\\work\\a.ts")).toBe("file:///C:/work/a.ts");
    expect(uriToPath("file:///C:/work/a.ts")).toBe("C:/work/a.ts");
    // Some servers escape the colon.
    expect(normalizeUri("file:///C%3A/work/a.ts")).toBe("file:///C:/work/a.ts");
  });

  it("treats differently-escaped URIs as the same document", () => {
    expect(normalizeUri("file:///a/@scope/x.ts")).toBe(normalizeUri("file:///a/%40scope/x.ts"));
    expect(uriToPath("untitled:Untitled-1")).toBeNull();
  });

  it("flattens every shape a definition can come back in", () => {
    const range = { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } };
    const expected = [{ uri: "file:///a.py", ...range }];
    expect(normalizeLocations(null)).toEqual([]);
    expect(normalizeLocations({ uri: "file:///a.py", range })).toEqual(expected);
    expect(normalizeLocations([{ uri: "file:///a.py", range }])).toEqual(expected);
    // LocationLink: the selection range is the name, the target range the whole body.
    expect(
      normalizeLocations([
        {
          targetUri: "file:///a.py",
          targetSelectionRange: range,
          targetRange: { start: { line: 0, character: 0 }, end: { line: 9, character: 0 } },
        },
      ]),
    ).toEqual(expected);
  });
});
