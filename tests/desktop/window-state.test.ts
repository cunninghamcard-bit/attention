import { describe, expect, it } from "vitest";
import { resolveWindowBounds, type DisplayProvider, type Rect } from "@desktop/window-state";

function displays(primary: Rect, all: Rect[] = [primary]): DisplayProvider {
  return {
    getPrimaryWorkArea: () => primary,
    getAllWorkAreas: () => all,
  };
}

const MAIN: Rect = { x: 0, y: 25, width: 1512, height: 944 };

describe("resolveWindowBounds (real fe)", () => {
  it("defaults to min(1024, workArea.width) x min(800, workArea.height - 1)", () => {
    expect(resolveWindowBounds({}, displays(MAIN))).toEqual({ width: 1024, height: 800 });
    const small: Rect = { x: 0, y: 0, width: 900, height: 700 };
    expect(resolveWindowBounds({}, displays(small))).toEqual({ width: 900, height: 699 });
  });

  it("restores saved bounds that overlap a display work area", () => {
    const state = { x: 100, y: 100, width: 800, height: 600 };
    expect(resolveWindowBounds(state, displays(MAIN))).toEqual(state);
  });

  it("rejects bounds fully outside every display (2px tolerance)", () => {
    const offscreen = { x: 5000, y: 5000, width: 800, height: 600 };
    expect(resolveWindowBounds(offscreen, displays(MAIN))).toEqual({ width: 1024, height: 800 });
  });

  it("accepts size-only state (x/y undefined, w/h defined)", () => {
    expect(resolveWindowBounds({ width: 640, height: 480 }, displays(MAIN))).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("clamps to the 300x200 floor", () => {
    expect(resolveWindowBounds({ width: 100, height: 50 }, displays(MAIN))).toEqual({
      width: 300,
      height: 200,
    });
  });

  it("checks all displays, not just the primary", () => {
    const second: Rect = { x: 1512, y: 0, width: 1920, height: 1080 };
    const state = { x: 1600, y: 100, width: 800, height: 600 };
    expect(resolveWindowBounds(state, displays(MAIN, [MAIN, second]))).toEqual(state);
  });

  it("falls back to 800x600 when screen info is unavailable", () => {
    const broken: DisplayProvider = {
      getPrimaryWorkArea: () => {
        throw new Error("no screen");
      },
      getAllWorkAreas: () => {
        throw new Error("no screen");
      },
    };
    expect(resolveWindowBounds({ x: 0, y: 0, width: 640, height: 480 }, broken)).toEqual({
      width: 800,
      height: 600,
    });
  });
});
