import { describe, expect, it } from "vitest";
import { App } from "../app/App";

async function createSearchApp(): Promise<App> {
  const app = new App(document.createElement("div"));
  await app.ready;
  await app.vault.create("notes/alpha.md", "---\nstatus: draft\ntags: [research]\n---\n\n# Intro\n\nneedle in the intro\n\n# Detail\n\nhay and needle together\n");
  await app.vault.create("notes/beta.md", "# Other\n\nonly hay here\nneedle on its own line\n#inline-tag\n");
  await app.vault.create("agent/server.go", "package main\n// needle in code\n");
  await app.metadataCache.initialize();
  // initialize() fires metadata computation without awaiting it.
  for (let i = 0; i < 100 && !app.metadataCache.getCache("notes/alpha.md")?.frontmatter; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return app;
}

describe("SearchEngine operators", () => {
  it("path: narrows results to matching paths", async () => {
    const app = await createSearchApp();
    const results = await app.search.search({ query: "path:agent needle" });
    expect(results.map((result) => result.path)).toEqual(["agent/server.go"]);
  });

  it("file: narrows by file name and matches without keywords", async () => {
    const app = await createSearchApp();
    const results = await app.search.search({ query: "file:beta" });
    expect(results.map((result) => result.path)).toEqual(["notes/beta.md"]);
    expect(results[0].matches).toEqual([]);
  });

  it("tag: matches frontmatter and inline tags", async () => {
    const app = await createSearchApp();
    const fromFrontmatter = await app.search.search({ query: "tag:research" });
    expect(fromFrontmatter.map((result) => result.path)).toEqual(["notes/alpha.md"]);
    const fromInline = await app.search.search({ query: "tag:#inline-tag" });
    expect(fromInline.map((result) => result.path)).toEqual(["notes/beta.md"]);
  });

  it("line:(a b) requires all words on the same line", async () => {
    const app = await createSearchApp();
    const results = await app.search.search({ query: "line:(hay needle)" });
    expect(results.map((result) => result.path)).toEqual(["notes/alpha.md"]);
    expect(results[0].matches.every((match) => match.line === 11)).toBe(true);
  });

  it("section:(a b) requires all words under the same heading", async () => {
    const app = await createSearchApp();
    const together = await app.search.search({ query: "section:(hay together)" });
    expect(together.map((result) => result.path)).toEqual(["notes/alpha.md"]);
    const split = await app.search.search({ query: "section:(intro together)" });
    expect(split).toEqual([]);
  });

  it("[property] and [property:value] match frontmatter", async () => {
    const app = await createSearchApp();
    const hasProperty = await app.search.search({ query: "[status]" });
    expect(hasProperty.map((result) => result.path)).toEqual(["notes/alpha.md"]);
    const wrongValue = await app.search.search({ query: "[status:final]" });
    expect(wrongValue).toEqual([]);
    const rightValue = await app.search.search({ query: "[status:draft]" });
    expect(rightValue.map((result) => result.path)).toEqual(["notes/alpha.md"]);
  });

  it("plain keywords still search every text file", async () => {
    const app = await createSearchApp();
    const results = await app.search.search({ query: "needle" });
    expect(results.map((result) => result.path)).toEqual(["agent/server.go", "notes/alpha.md", "notes/beta.md"]);
  });
});
