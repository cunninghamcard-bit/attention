import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ dialog: {}, ipcMain: {}, BrowserWindow: {} }));
vi.mock("@desktop/net-request", () => ({ performNetRequest: vi.fn() }));
import { toFilters, toOpenProperties } from "@desktop/desktop-bridge";

describe("toOpenProperties", () => {
  it("selects openDirectory for directory picks", () => {
    expect(toOpenProperties({ directory: true })).toEqual(["openDirectory"]);
  });
  it("adds multiSelections only when multiple", () => {
    expect(toOpenProperties({})).toEqual(["openFile"]);
    expect(toOpenProperties({ multiple: true })).toEqual(["openFile", "multiSelections"]);
  });
});

describe("toFilters", () => {
  it("wraps extensions, or is undefined when none", () => {
    expect(toFilters(["md", "txt"])).toEqual([{ name: "Files", extensions: ["md", "txt"] }]);
    expect(toFilters([])).toBeUndefined();
    expect(toFilters()).toBeUndefined();
  });
});
