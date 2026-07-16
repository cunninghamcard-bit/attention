import { beforeEach, describe, expect, it, vi } from "vitest";

const getFonts = vi.fn();

vi.mock("font-list", () => ({
  getFonts: (...args: unknown[]) => getFonts(...args),
}));

import { listSystemFontFamilies } from "@desktop/system-fonts";

describe("listSystemFontFamilies", () => {
  beforeEach(() => {
    getFonts.mockReset();
  });

  it("returns de-quoted unique families from font-list", async () => {
    getFonts.mockResolvedValue(['"Arial"', "Helvetica", "Arial", "  Menlo  "]);
    await expect(listSystemFontFamilies()).resolves.toEqual(["Arial", "Helvetica", "Menlo"]);
    expect(getFonts).toHaveBeenCalledWith({ disableQuoting: true });
  });

  it("returns an empty list when font-list fails", async () => {
    getFonts.mockRejectedValue(new Error("no fonts"));
    await expect(listSystemFontFamilies()).resolves.toEqual([]);
  });
});
