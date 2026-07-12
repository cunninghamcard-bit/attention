import { describe, expect, it } from "vitest";
import { apiBaseUrlForHost, parseGitRemoteUrl } from "./resolveRepository";

describe("parseGitRemoteUrl", () => {
  it("parses HTTPS github URLs", () => {
    expect(parseGitRemoteUrl("https://github.com/acme/widget.git")).toEqual({
      host: "github.com",
      owner: "acme",
      repo: "widget",
    });
  });

  it("parses SSH scp-style URLs", () => {
    expect(parseGitRemoteUrl("git@github.com:acme/widget.git")).toEqual({
      host: "github.com",
      owner: "acme",
      repo: "widget",
    });
  });

  it("parses GHES hosts", () => {
    expect(parseGitRemoteUrl("https://github.example.com/eng/app")).toEqual({
      host: "github.example.com",
      owner: "eng",
      repo: "app",
    });
    expect(apiBaseUrlForHost("github.example.com")).toBe("https://github.example.com/api/v3");
  });

  it("returns null for garbage", () => {
    expect(parseGitRemoteUrl("")).toBeNull();
    expect(parseGitRemoteUrl("not-a-url")).toBeNull();
  });
});
