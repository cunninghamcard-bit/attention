import { describe, expect, it } from "vitest";
import type { Vault } from "./Vault";
import { TFile } from "./TAbstractFile";

const vault = { cacheLimit: 0 } as unknown as Vault;

describe("TFile public API parity", () => {
  it("matches Obsidian's basename and extension semantics", () => {
    const markdown = new TFile(vault, "Upper.MD");
    expect(markdown.extension).toBe("md");
    expect(markdown.basename).toBe("Upper");
    expect(markdown.getShortName()).toBe("Upper");
    expect(markdown.getNewPathAfterRename("Renamed")).toBe("Renamed.md");

    const dotfile = new TFile(vault, ".env");
    expect(dotfile.extension).toBe("");
    expect(dotfile.basename).toBe(".env");

    const trailingDot = new TFile(vault, "file.");
    expect(trailingDot.extension).toBe("");
    expect(trailingDot.basename).toBe("file.");
  });
});
