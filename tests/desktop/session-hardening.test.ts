import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ session: {}, }));
import {
  isPermissionAllowed,
  rewriteRequestHeaders,
  rewriteResponseHeaders,
} from "@desktop/session-hardening";

describe("rewriteRequestHeaders", () => {
  it("adds a Referer for YouTube embeds when missing", () => {
    expect(rewriteRequestHeaders("https://www.youtube.com/embed/x", {})).toEqual({
      Referer: "md.obsidian",
    });
    expect(
      rewriteRequestHeaders("https://www.youtube-nocookie.com/embed/x", { Referer: "keep" }).Referer,
    ).toBe("keep");
  });

  it("strips sec-fetch-dest / sec-ch-ua on other requests", () => {
    const out = rewriteRequestHeaders("https://example.com", {
      "Sec-Fetch-Dest": "empty",
      "sec-ch-ua": "chromium",
      Accept: "text/html",
    });
    expect(out).toEqual({ Accept: "text/html" });
  });
});

describe("rewriteResponseHeaders", () => {
  it("strips x-frame-options and COOP", () => {
    const out = rewriteResponseHeaders(
      { "X-Frame-Options": ["DENY"], "Cross-Origin-Opener-Policy": ["same-origin"], "Content-Length": ["5"] },
      false,
    );
    expect(out).toEqual({ "Content-Length": ["5"] });
  });

  it("removes frame-ancestors from CSP", () => {
    const out = rewriteResponseHeaders(
      { "Content-Security-Policy": ["default-src 'self'; frame-ancestors 'none'; img-src *"] },
      false,
    );
    expect(out["Content-Security-Policy"][0]).not.toContain("frame-ancestors");
    expect(out["Content-Security-Policy"][0]).toContain("img-src *");
  });

  it("relaxes SameSite=Lax to None for secure subframe cookies only", () => {
    const cookie = ["sid=1; SameSite=Lax; Secure;"];
    expect(rewriteResponseHeaders({ "Set-Cookie": [...cookie] }, true)["Set-Cookie"][0]).toContain(
      "SameSite=None",
    );
    expect(rewriteResponseHeaders({ "Set-Cookie": [...cookie] }, false)["Set-Cookie"][0]).toContain(
      "SameSite=Lax",
    );
  });
});

describe("isPermissionAllowed", () => {
  it("allows app-origin requests, denies foreign ones", () => {
    expect(isPermissionAllowed("app://obsidian.md/index.html", "notifications", {})).toBe(true);
    expect(isPermissionAllowed("https://evil.com", "notifications", {})).toBe(false);
  });
  it("always denies openExternal and allows fullscreen", () => {
    expect(isPermissionAllowed("app://obsidian.md/x", "openExternal", {})).toBe(false);
    expect(isPermissionAllowed("https://evil.com", "fullscreen", {})).toBe(true);
  });
  it("allows clipboard from an about:blank main frame", () => {
    expect(
      isPermissionAllowed("https://x", "clipboard-read", {
        isMainFrame: true,
        requestingUrl: "about:blank",
      }),
    ).toBe(true);
  });
});
