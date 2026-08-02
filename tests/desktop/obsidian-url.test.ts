import { describe, expect, it } from "vitest";
import { buildObsActScript, parseObsidianUrl } from "@desktop/obsidian-url";

describe("parseObsidianUrl (real $e parse)", () => {
  it("rejects non-obsidian URLs", () => {
    expect(parseObsidianUrl("https://x")).toEqual({ kind: "invalid" });
  });

  it("parses a leading-slash path into an open action", () => {
    expect(parseObsidianUrl("attention:///Users/me/note.md")).toEqual({
      kind: "action",
      action: { action: "open", path: "/Users/me/note.md" },
    });
  });

  it("drops the leading slash on Windows", () => {
    expect(parseObsidianUrl("attention:///C:/n.md", { isWindows: true })).toEqual({
      kind: "action",
      action: { action: "open", path: "C:/n.md" },
    });
  });

  it("routes sync-setup / choose-vault to the starter", () => {
    expect(parseObsidianUrl("attention://sync-setup").kind).toBe("starter");
    expect(parseObsidianUrl("attention://choose-vault").kind).toBe("starter");
  });

  it("parses vault/<name>/<file> (decoded)", () => {
    expect(parseObsidianUrl("attention://vault/My%20Vault/dir/a%20b.md")).toEqual({
      kind: "action",
      action: { action: "open", vault: "My Vault", file: "dir/a b.md" },
    });
  });

  it("parses a generic action with query and hash", () => {
    const parsed = parseObsidianUrl("attention://advanced-uri?file=Note&mode=append#heading");
    expect(parsed).toEqual({
      kind: "action",
      action: { action: "advanced-uri", file: "Note", mode: "append", hash: "heading" },
    });
  });

  it("defaults a valueless query param to 'true' and strips trailing slashes", () => {
    const parsed = parseObsidianUrl("attention://open/?flag");
    expect(parsed).toEqual({ kind: "action", action: { action: "open", flag: "true" } });
  });
});

describe("buildObsActScript (real it injection)", () => {
  it("installs or queues window.OBS_ACT with the action JSON", () => {
    const script = buildObsActScript({ action: "open", file: "n.md" });
    expect(script).toContain('"action":"open"');
    expect(script).toContain('"file":"n.md"');
    expect(script).toContain("w.OBS_ACT");
    expect(script).toContain('typeof w.OBS_ACT === "function"');
  });
});
