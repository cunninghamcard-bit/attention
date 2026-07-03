import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  buildObsActScript,
  parseObsidianUrl,
  resolveVaultForAction,
} from "./obsidian-url";
import type { VaultRegistryData } from "./vault-registry";

describe("parseObsidianUrl (real $e parse)", () => {
  it("rejects non-obsidian URLs", () => {
    expect(parseObsidianUrl("https://x")).toEqual({ kind: "invalid" });
  });

  it("parses a leading-slash path into an open action", () => {
    expect(parseObsidianUrl("obsidian:///Users/me/note.md")).toEqual({
      kind: "action",
      action: { action: "open", path: "/Users/me/note.md" },
    });
  });

  it("drops the leading slash on Windows", () => {
    expect(parseObsidianUrl("obsidian:///C:/n.md", { isWindows: true })).toEqual({
      kind: "action",
      action: { action: "open", path: "C:/n.md" },
    });
  });

  it("routes sync-setup / choose-vault to the starter", () => {
    expect(parseObsidianUrl("obsidian://sync-setup").kind).toBe("starter");
    expect(parseObsidianUrl("obsidian://choose-vault").kind).toBe("starter");
  });

  it("parses vault/<name>/<file> (decoded)", () => {
    expect(parseObsidianUrl("obsidian://vault/My%20Vault/dir/a%20b.md")).toEqual({
      kind: "action",
      action: { action: "open", vault: "My Vault", file: "dir/a b.md" },
    });
  });

  it("parses a generic action with query and hash", () => {
    const parsed = parseObsidianUrl("obsidian://advanced-uri?file=Note&mode=append#heading");
    expect(parsed).toEqual({
      kind: "action",
      action: { action: "advanced-uri", file: "Note", mode: "append", hash: "heading" },
    });
  });

  it("defaults a valueless query param to 'true' and strips trailing slashes", () => {
    const parsed = parseObsidianUrl("obsidian://open/?flag");
    expect(parsed).toEqual({ kind: "action", action: { action: "open", flag: "true" } });
  });
});

describe("resolveVaultForAction (real $e resolution)", () => {
  const vaults: VaultRegistryData = {
    a1: { path: resolve("/vaults/Alpha"), ts: 1 },
    b2: { path: resolve("/vaults/Alpha Beta"), ts: 1 },
  };

  it("resolves by longest matching path and sets the relative file", () => {
    const out = resolveVaultForAction({ action: "open", path: resolve("/vaults/Alpha/n.md") }, vaults);
    expect(out.vaultId).toBe("a1");
    expect(out.action.file).toBe("/n.md");
    expect(out.useMostRecent).toBe(false);
  });

  it("resolves by vault name (case-insensitive basename)", () => {
    const out = resolveVaultForAction({ action: "open", vault: "alpha beta" }, vaults);
    expect(out.vaultId).toBe("b2");
  });

  it("returns null vaultId for an unknown vault name", () => {
    expect(resolveVaultForAction({ action: "open", vault: "ghost" }, vaults).vaultId).toBeNull();
  });

  it("defers to the most-recent vault when neither path nor vault is given", () => {
    const out = resolveVaultForAction({ action: "search", query: "x" }, vaults);
    expect(out.useMostRecent).toBe(true);
    expect(out.vaultId).toBeNull();
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
