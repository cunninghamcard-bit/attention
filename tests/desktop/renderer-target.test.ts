import { describe, expect, it } from "vitest";
import {
  APP_INDEX_URL,
  isDevRendererTarget,
  resolveRendererUrl,
} from "@desktop/renderer-target";

describe("resolveRendererUrl", () => {
  it("uses the Vite dev server URL when ELECTRON_RENDERER_URL is set", () => {
    const env = { ELECTRON_RENDERER_URL: "http://127.0.0.1:5173" };
    expect(resolveRendererUrl(env)).toBe("http://127.0.0.1:5173");
    expect(isDevRendererTarget(env)).toBe(true);
  });

  it("falls back to the app:// index in production (matches real `je`)", () => {
    const env = {};
    expect(resolveRendererUrl(env)).toBe(APP_INDEX_URL);
    expect(APP_INDEX_URL).toBe("app://obsidian.md/index.html");
    expect(isDevRendererTarget(env)).toBe(false);
  });

  it("treats an empty dev URL as unset", () => {
    const env = { ELECTRON_RENDERER_URL: "" };
    expect(resolveRendererUrl(env)).toBe(APP_INDEX_URL);
    expect(isDevRendererTarget(env)).toBe(false);
  });
});
