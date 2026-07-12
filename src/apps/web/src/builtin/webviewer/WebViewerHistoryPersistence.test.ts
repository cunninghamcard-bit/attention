import { describe, expect, it } from "vitest";
import { App } from "../../app/App";

// History must survive an app restart (real Obsidian keeps it in IndexedDB;
// we persist through vault-local storage) — without this the address bar
// suggests nothing but the Blank seed after every launch.
describe("webviewer history persistence", () => {
  it("restores recorded history in a fresh service instance", async () => {
    const first = new App(document.createElement("div"));
    await first.ready;
    first.webViewer.clearHistory();
    first.webViewer.recordHistory("https://persisted.example/", "Persisted page");

    const second = new App(document.createElement("div"));
    await second.ready;
    const urls = second.webViewer.listHistory().map((entry) => entry.url);
    expect(urls).toContain("https://persisted.example/");

    second.webViewer.clearHistory();
    const third = new App(document.createElement("div"));
    await third.ready;
    expect(third.webViewer.listHistory()).toHaveLength(0);
  });
});
