import { afterEach, describe, expect, it, vi } from "vitest";

const execFile = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFile(...args),
}));

import { listSystemFontFamilies } from "@desktop/system-fonts";

/** promisify(execFile) calls the node-style callback with (err, {stdout}). */
function replyWith(stdout: string): void {
  execFile.mockImplementation((...args: unknown[]) => {
    const done = args.at(-1) as (err: unknown, out: { stdout: string }) => void;
    done(null, { stdout });
  });
}

function failWith(message: string): void {
  execFile.mockImplementation((...args: unknown[]) => {
    const done = args.at(-1) as (err: unknown) => void;
    done(new Error(message));
  });
}

function onPlatform(platform: string): void {
  const original = process.platform;
  Object.defineProperty(process, "platform", { configurable: true, value: platform });
  afterEach(() => {
    Object.defineProperty(process, "platform", { configurable: true, value: original });
  });
}

describe("listSystemFontFamilies", () => {
  afterEach(() => {
    execFile.mockReset();
  });

  it("parses Family: lines out of system_profiler, de-duplicated and sorted", async () => {
    onPlatform("darwin");
    // Shape of real `system_profiler SPFontsDataType` output: every face repeats
    // its family, so de-duplication is the whole job.
    replyWith(
      [
        "Fonts:",
        "    Menlo:",
        "      Fonts:",
        "          Menlo-Regular:",
        "              Full Name: Menlo Regular",
        "              Family: Menlo",
        "          Menlo-Bold:",
        "              Family: Menlo",
        "    JetBrainsMono Nerd Font:",
        "              Family: JetBrainsMono Nerd Font",
        "              Family: Maple Mono NF CN",
        "",
      ].join("\n"),
    );

    await expect(listSystemFontFamilies()).resolves.toEqual([
      "JetBrainsMono Nerd Font",
      "Maple Mono NF CN",
      "Menlo",
    ]);
    expect(execFile).toHaveBeenCalledWith(
      "system_profiler",
      ["SPFontsDataType"],
      expect.objectContaining({ maxBuffer: expect.any(Number) }),
      expect.any(Function),
    );
  });

  it("takes the family from fc-list on linux, ignoring alias tails", async () => {
    onPlatform("linux");
    replyWith(["DejaVu Sans,DejaVu Sans Book", "Noto Sans Syriac", "DejaVu Sans", ""].join("\n"));

    await expect(listSystemFontFamilies()).resolves.toEqual(["DejaVu Sans", "Noto Sans Syriac"]);
  });

  it("rejects instead of returning an empty list when the OS call fails", async () => {
    onPlatform("darwin");
    failWith("system_profiler exploded");

    // An empty array is indistinguishable from "no fonts installed", and that
    // is precisely how a broken font-list bundle stayed hidden: the renderer
    // fell back to its hardcoded seed list and every third-party font silently
    // vanished from the picker. Enumeration failure has to surface.
    await expect(listSystemFontFamilies()).rejects.toThrow("system_profiler exploded");
  });

  it("rejects on a platform with no enumeration path", async () => {
    onPlatform("win32");

    await expect(listSystemFontFamilies()).rejects.toThrow(/not implemented for win32/);
    expect(execFile).not.toHaveBeenCalled();
  });
});
