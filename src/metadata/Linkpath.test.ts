import { describe, expect, it } from "vitest";
import { parseLinktext, splitLinkpath } from "./Linkpath";

describe("Linkpath helpers", () => {
  it("splits linkpaths while preserving nested heading separators", () => {
    expect(splitLinkpath("Target#Heading#Child")).toEqual({
      path: "Target",
      subpath: "#Heading#Child",
    });
  });

  it("parses linktext aliases into open-link state subpaths", () => {
    expect(parseLinktext(" Target#Heading#Child | Alias ")).toEqual({
      path: "Target",
      subpath: "Heading#Child",
    });
  });
});
