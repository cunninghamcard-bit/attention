import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureZshShim } from "./zsh-shim";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(join(tmpdir(), "zsh-shim-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe("ensureZshShim", () => {
  it("writes .zshenv and .zshrc that source the user's own rc first", () => {
    const dir = ensureZshShim({ homeDir: home });
    expect(dir).toBe(join(home, ".config", "workbench", "zsh"));
    const zshrc = fs.readFileSync(join(dir!, ".zshrc"), "utf8");
    const zshenv = fs.readFileSync(join(dir!, ".zshenv"), "utf8");
    expect(zshenv).toContain('source "$HOME/.zshenv"');
    expect(zshrc.indexOf('source "$HOME/.zshrc"')).toBeLessThan(zshrc.indexOf("starship"));
    // syntax highlighting is layered last
    expect(zshrc.indexOf("zsh-autosuggestions.zsh")).toBeLessThan(zshrc.indexOf("fast-syntax-highlighting.plugin.zsh"));
  });

  it("keeps history in the user's home, not the shim dir", () => {
    const dir = ensureZshShim({ homeDir: home });
    expect(fs.readFileSync(join(dir!, ".zshrc"), "utf8")).toContain('HISTFILE="$HOME/.zsh_history"');
  });

  it("is idempotent but regenerates when the version stamp changes", () => {
    const dir = ensureZshShim({ homeDir: home })!;
    const path = join(dir, ".zshrc");
    const first = fs.statSync(path).mtimeMs;
    ensureZshShim({ homeDir: home });
    expect(fs.statSync(path).mtimeMs).toBe(first);
    fs.writeFileSync(path, "# workbench-zsh-shim v0 stale\n");
    ensureZshShim({ homeDir: home });
    expect(fs.readFileSync(path, "utf8")).not.toContain("v0 stale");
  });

  it("returns null instead of throwing when the shim dir is unwritable", () => {
    expect(ensureZshShim({ homeDir: home, configDir: "/dev/null/nope" })).toBeNull();
  });
});
