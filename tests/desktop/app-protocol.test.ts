import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  computeContentRange,
  contentTypeFor,
  createFileOrigin,
  resolveAppUrl,
  type ResolveDeps,
} from "@desktop/app-protocol";

const RES = "/app/resources";
const FILE_ORIGIN = "app://abcdef0123456789/";
const deps: ResolveDeps = { resourcesDir: RES, fileOrigin: FILE_ORIGIN, isWindows: false };

describe("resolveAppUrl (real e())", () => {
  it("resolves renderer resources under the resources dir, with noframe", () => {
    expect(resolveAppUrl("app://obsidian.md/index.html", deps)).toEqual({
      path: resolve(RES, "index.html"),
      noframe: true,
    });
    expect(resolveAppUrl("app://obsidian.md/assets/app.js", deps)).toEqual({
      path: resolve(RES, "assets/app.js"),
      noframe: true,
    });
  });

  it("strips query and hash before resolving", () => {
    expect(resolveAppUrl("app://obsidian.md/index.html?v=1#top", deps).path).toBe(
      resolve(RES, "index.html"),
    );
  });

  it("rejects path traversal that escapes the resources dir (400)", () => {
    expect(resolveAppUrl("app://obsidian.md/../../etc/passwd", deps)).toEqual({
      path: "",
      noframe: true,
    });
  });

  it("maps the file origin to an absolute path (POSIX prefixes '/')", () => {
    expect(resolveAppUrl(`${FILE_ORIGIN}Users/me/vault/a.png`, deps)).toEqual({
      path: "/Users/me/vault/a.png",
      noframe: false,
    });
  });

  it("decodes percent-encoding in file paths", () => {
    expect(resolveAppUrl(`${FILE_ORIGIN}Users/me/My%20Vault/a%20b.md`, deps).path).toBe(
      "/Users/me/My Vault/a b.md",
    );
  });

  it("flags remote file paths as noframe via the injected predicate (real ft)", () => {
    // isRemotePath runs on the resolved absolute path.
    const isRemotePath = (p: string) => p.startsWith("/net/");
    expect(resolveAppUrl(`${FILE_ORIGIN}net/share/x`, { ...deps, isRemotePath }).noframe).toBe(
      true,
    );
    expect(resolveAppUrl(`${FILE_ORIGIN}Users/me/a.png`, { ...deps, isRemotePath }).noframe).toBe(
      false,
    );
  });

  it("returns '' (400) for an unknown origin", () => {
    expect(resolveAppUrl("app://evil.example/x", deps)).toEqual({ path: "", noframe: false });
    expect(resolveAppUrl("https://obsidian.md/x", deps)).toEqual({ path: "", noframe: false });
  });
});

describe("computeContentRange (real Range branch)", () => {
  it("returns a full 200 with Content-Length when no Range header", () => {
    expect(computeContentRange(null, 500)).toEqual({
      status: 200,
      start: 0,
      end: 499,
      headers: { "Content-Length": "500" },
    });
  });

  it("computes a 206 partial response", () => {
    expect(computeContentRange("bytes=0-99", 500)).toEqual({
      status: 206,
      start: 0,
      end: 99,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": "100",
        "Content-Range": "bytes 0-99/500",
      },
    });
  });

  it("defaults an open-ended range to the last byte", () => {
    const out = computeContentRange("bytes=100-", 500);
    expect(out).toMatchObject({ status: 206, start: 100, end: 499 });
    expect(out.headers["Content-Range"]).toBe("bytes 100-499/500");
  });

  it("returns 416 for an unsatisfiable or malformed range", () => {
    expect(computeContentRange("bytes=600-700", 500).status).toBe(416);
    expect(computeContentRange("bytes=200-100", 500).status).toBe(416);
    expect(computeContentRange("chars=0-1", 500).status).toBe(416);
  });
});

describe("contentTypeFor", () => {
  it("maps the extensions ES modules and stylesheets need to execute", () => {
    expect(contentTypeFor("/x/index-abc.js")).toBe("text/javascript");
    expect(contentTypeFor("/x/index.mjs")).toBe("text/javascript");
    expect(contentTypeFor("/x/app.css")).toBe("text/css");
    expect(contentTypeFor("/x/index.html")).toBe("text/html");
    expect(contentTypeFor("/x/font.woff2")).toBe("font/woff2");
    expect(contentTypeFor("/x/icon.svg")).toBe("image/svg+xml");
  });

  it("is undefined for unknown or extensionless paths", () => {
    expect(contentTypeFor("/x/README")).toBeUndefined();
    expect(contentTypeFor("/x/data.weird")).toBeUndefined();
  });
});

describe("createFileOrigin (real Be)", () => {
  it("is app://<36 chars>/ and unique per launch", () => {
    const a = createFileOrigin();
    expect(a).toMatch(/^app:\/\/[0-9a-f]{36}\/$/);
    expect(createFileOrigin()).not.toBe(a);
  });
});
