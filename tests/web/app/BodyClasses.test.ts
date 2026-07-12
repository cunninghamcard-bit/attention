import { describe, expect, it } from "vitest";
import { applyObsidianBodyClasses } from "@web/app/BodyClasses";

function fakeWindow(platform: string, userAgent = ""): Window {
  return { navigator: { platform, userAgent } } as unknown as Window;
}

describe("applyObsidianBodyClasses", () => {
  it("marks the body and applies the platform class", () => {
    const body = document.createElement("div");
    applyObsidianBodyClasses(body, fakeWindow("Win32"));
    expect(body.classList.contains("obsidian-app")).toBe(true);
    expect(body.classList.contains("mod-windows")).toBe(true);
  });

  it("adds styled-scrollbars on non-macOS platforms only (Yl.isMacOS || addClass)", () => {
    const linux = document.createElement("div");
    applyObsidianBodyClasses(linux, fakeWindow("Linux x86_64"));
    expect(linux.classList.contains("styled-scrollbars")).toBe(true);

    const mac = document.createElement("div");
    applyObsidianBodyClasses(mac, fakeWindow("MacIntel"));
    expect(mac.classList.contains("mod-macos")).toBe(true);
    expect(mac.classList.contains("styled-scrollbars")).toBe(false);
  });
});
