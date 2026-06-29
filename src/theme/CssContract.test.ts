import { describe, expect, it } from "vitest";

const fileSystemSpecifier = "node:fs";

const defaultCssImports = [
  "./styles/app.css",
];

const forbiddenDefaultImports = [
  "./theme/obsidian-structure.css",
  "./theme/reconstruction/index.css",
  "./theme/reconstruction/runtime.css",
  "./theme/reconstruction/icons.css",
];

const forbiddenCoreSelectors = [
  ".app-container",
  ".workspace",
  ".workspace-ribbon",
  ".workspace-split",
  ".workspace-tabs",
  ".workspace-tab-header",
  ".workspace-leaf",
  ".workspace-leaf-content",
  ".view-header",
  ".view-content",
  "[data-icon]",
];

describe("Obsidian CSS contract", () => {
  it("keeps the default startup surface on the real Obsidian app.css artifact", async () => {
    const mainSource = await readProjectFile("src/main.ts");
    const cssImports = [...mainSource.matchAll(/import\s+["']([^"']+\.css)["'];?/g)].map((match) => match[1]);

    expect(cssImports).toEqual(defaultCssImports);
    for (const cssImport of forbiddenDefaultImports) {
      expect(mainSource, `${cssImport} must stay out of the default startup chain`).not.toContain(cssImport);
    }
  });

  it("keeps quarantined reconstruction CSS away from core Obsidian layout selectors", async () => {
    for (const file of await getQuarantinedCssFiles()) {
      const source = await readProjectFile(file);
      for (const selector of forbiddenCoreSelectors) {
        expect(source, `${file} must not redefine ${selector}`).not.toContain(selector);
      }
    }
  });
});

async function getQuarantinedCssFiles(): Promise<string[]> {
  const fs = await loadFileSystemModule();
  return [
    "src/theme/obsidian-structure.css",
    ...fs.readdirSync("src/theme/reconstruction")
      .filter((name) => name.endsWith(".css"))
      .map((name) => `src/theme/reconstruction/${name}`)
      .sort(),
  ];
}

async function readProjectFile(path: string): Promise<string> {
  const fs = await loadFileSystemModule();
  return fs.readFileSync(path, "utf8");
}

async function loadFileSystemModule(): Promise<FileSystemModule> {
  return await import(fileSystemSpecifier) as FileSystemModule;
}

interface FileSystemModule {
  readFileSync(path: string, encoding: "utf8"): string;
  readdirSync(path: string): string[];
}
