import { describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { SearchView } from "@web/builtin/SearchView";

async function createSearchView(): Promise<{ app: App; view: SearchView }> {
  const app = new App(document.createElement("div"));
  await app.ready;
  await app.vault.create("notes/Alpha.md", "first needle\nsecond line\n");
  await app.vault.create("notes/beta.md", "only needle here\n");
  await app.vault.create("src/main.ts", "const needle = true;\n");

  const view = new SearchView(app.workspace.getLeaf(true));
  await view.onOpen();
  return { app, view };
}

async function flushSearch(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("SearchView", () => {
  it("renders Obsidian search structure and grouped matches", async () => {
    const { view } = await createSearchView();
    view.setQuery("needle");
    await flushSearch();

    expect(view.contentEl.querySelector(".search-row")).not.toBeNull();
    expect(
      view.contentEl.querySelector(".search-result-container.mod-global-search"),
    ).not.toBeNull();
    expect(view.contentEl.querySelector(".search-info-container")).not.toBeNull();
    expect(view.contentEl.querySelector(".search-results-info")).not.toBeNull();
    expect(
      view.contentEl.querySelector(".input-right-decorator .lucide-uppercase-lowercase-a"),
    ).not.toBeNull();
    expect(
      view.contentEl.querySelector(".search-row > .clickable-icon .lucide-sliders-horizontal"),
    ).not.toBeNull();
    expect(view.contentEl.querySelector(".search-results-result-count")?.textContent).toContain(
      "3 results in 3 files",
    );
    expect(view.contentEl.querySelectorAll(".tree-item.search-result")).toHaveLength(3);
    expect(view.contentEl.querySelector(".search-result-file-matched-text")?.textContent).toBe(
      "needle",
    );
  });

  it("persists matching case, collapse, and sort state", async () => {
    const { view } = await createSearchView();
    view.setQuery("needle");
    await flushSearch();

    const matchCaseButton = view.contentEl.querySelector<HTMLElement>(".input-right-decorator");
    matchCaseButton?.click();
    await flushSearch();
    const filterButton = view.contentEl.querySelector<HTMLElement>(".search-row > .clickable-icon");
    filterButton?.click();
    const collapseToggle = view.contentEl.querySelector<HTMLInputElement>(
      ".search-params input[type=checkbox]",
    );
    collapseToggle?.dispatchEvent(new Event("change", { bubbles: true }));
    const parameterToggles = view.contentEl.querySelectorAll<HTMLInputElement>(
      ".search-params input[type=checkbox]",
    );
    parameterToggles[1]?.dispatchEvent(new Event("change", { bubbles: true }));
    parameterToggles[2]?.dispatchEvent(new Event("change", { bubbles: true }));
    const sort = view.contentEl.querySelector<HTMLSelectElement>(".search-results-info select");
    if (sort) {
      sort.value = "alphabeticalReverse";
      sort.dispatchEvent(new Event("change", { bubbles: true }));
    }

    expect(view.getState()).toMatchObject({
      matchingCase: true,
      collapseAll: true,
      extraContext: true,
      explainSearch: true,
      sortOrder: "alphabeticalReverse",
    });
    expect(view.contentEl.querySelector<HTMLElement>(".search-params")?.style.display).toBe("flex");
    expect(view.contentEl.querySelectorAll(".search-result.is-collapsed")).toHaveLength(3);
  });

  it("opens a result with the exact match range", async () => {
    const { app, view } = await createSearchView();
    view.setQuery("needle");
    await flushSearch();

    const openFile = vi.spyOn(app.workspace, "openFile");
    const match = view.contentEl.querySelector<HTMLElement>(".search-result-file-match");
    match?.click();
    await flushSearch();

    expect(openFile).toHaveBeenCalledWith(
      app.vault.getFileByPath("notes/Alpha.md"),
      expect.objectContaining({
        active: true,
        eState: { line: 0, matchStart: 6, matchEnd: 12 },
      }),
    );
  });

  it("handles empty queries and ignores stale results", async () => {
    const { view } = await createSearchView();
    view.setQuery("needle");
    view.setQuery("");
    await flushSearch();

    expect(view.contentEl.querySelectorAll(".tree-item.search-result")).toHaveLength(0);
    expect(view.contentEl.querySelector<HTMLElement>(".search-empty-state")?.style.display).toBe(
      "",
    );
    expect(view.getState().query).toBe("");
  });

  it("does not list every file for an unfinished file operator", async () => {
    const { view } = await createSearchView();
    view.setQuery("file:");
    await flushSearch();

    expect(view.contentEl.querySelector(".search-results-result-count")?.textContent).toContain(
      "0 results in 0 files",
    );
    expect(view.contentEl.querySelectorAll(".tree-item.search-result")).toHaveLength(0);
  });

  it("reports a search error without partial results", async () => {
    const { app, view } = await createSearchView();
    vi.spyOn(app.search, "search").mockRejectedValueOnce(new Error("Invalid search query"));

    view.setQuery("needle");
    await flushSearch();

    expect(view.contentEl.querySelector(".search-info")?.textContent).toBe("Invalid search query");
    expect(view.contentEl.querySelectorAll(".tree-item.search-result")).toHaveLength(0);
  });
});
