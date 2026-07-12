import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { App } from "../../../app/App";
import type { ElectronGitApi, GitExecResult } from "../GitService";

// CodeView drags the full shiki/highlighter stack into jsdom; a structural
// stub keeps these tests about OUR surface: headers, sidebar, commit flow.
vi.mock("@pierre/diffs/react", () => ({
  CodeView: ({ items, renderCustomHeader, renderAnnotation, renderGutterUtility }: {
    items: { id: string; annotations?: { metadata?: unknown }[] }[];
    renderCustomHeader?: (item: unknown) => ReactNode;
    renderAnnotation?: (annotation: unknown, item: unknown) => ReactNode;
    renderGutterUtility?: (getHoveredLine: () => { lineNumber: number; side: "additions" }, item: unknown) => ReactNode;
  }) => (
    <div data-testid="codeview">
      {items.map((item) => (
        <div key={item.id} data-item={item.id}>
          {renderCustomHeader?.(item)}
          <div data-gutter={item.id}>{renderGutterUtility?.(() => ({ lineNumber: 5, side: "additions" }), item)}</div>
          {item.annotations?.map((annotation, index) => (
            <div key={index}>{renderAnnotation?.(annotation, item)}</div>
          ))}
        </div>
      ))}
    </div>
  ),
}));

import { GitReviewView, openGitReview } from "./GitReviewView";
import { readViewed } from "./reviewModel";

function fakeBridge(): ElectronGitApi & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    available: true,
    calls,
    async exec(args: string[]): Promise<GitExecResult> {
      calls.push(args);
      if (args[0] === "rev-parse") return { code: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "status") return { code: 0, stdout: " M agent.ts\n?? notes.md\n", stderr: "" };
      if (args[0] === "diff" && args.includes("--numstat")) return { code: 0, stdout: "3\t1\tagent.ts\n", stderr: "" };
      if (args[0] === "show" && args[1] === "HEAD:agent.ts") return { code: 0, stdout: "line one\nline two\n", stderr: "" };
      if (args[0] === "show") return { code: 128, stdout: "", stderr: "fatal: bad object" };
      if (args[0] === "reset" || args[0] === "add") return { code: 0, stdout: "", stderr: "" };
      if (args[0] === "commit") return { code: 0, stdout: "[main abc] ok", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

async function reviewApp(): Promise<{ app: App; bridge: ReturnType<typeof fakeBridge> }> {
  const app = new App(document.createElement("div"));
  const bridge = fakeBridge();
  app.git.bridgeFactory = () => bridge;
  (app.vault.adapter as { getBasePath?: () => string }).getBasePath = () => "/fake/vault";
  await app.ready;
  await app.vault.create("agent.ts", "line one\nline CHANGED\n");
  await app.vault.create("notes.md", "brand new\n");
  return { app, bridge };
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > 3000) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("GitReviewView", () => {
  it("renders the working-tree review with sidebar, cards and progress", async () => {
    const { app } = await reviewApp();
    await openGitReview(app);
    const view = app.workspace.getLeavesOfType(GitReviewView.VIEW_TYPE)[0].view as GitReviewView;

    await until(() => view.contentEl.querySelectorAll(".review-file-row").length === 2, "sidebar rows");
    const rows = [...view.contentEl.querySelectorAll(".review-file-row")].map((el) => el.textContent);
    expect(rows[0]).toContain("agent.ts");
    expect(rows[0]).toContain("+3");
    expect(rows[1]).toContain("notes.md");
    expect(view.contentEl.querySelector(".review-progress-text")!.textContent).toBe("0 / 2 viewed");
    expect(view.contentEl.querySelectorAll(".review-card-header")).toHaveLength(2);
    expect(view.contentEl.querySelector(".review-chip.mod-untracked")).not.toBeNull();
  });

  it("marks files viewed, persists by fingerprint and updates progress", async () => {
    const { app } = await reviewApp();
    await openGitReview(app);
    const view = app.workspace.getLeavesOfType(GitReviewView.VIEW_TYPE)[0].view as GitReviewView;
    await until(() => view.contentEl.querySelectorAll(".review-viewed input").length === 2, "viewed checkboxes");

    (view.contentEl.querySelector(".review-viewed input") as HTMLInputElement).click();
    await until(() => view.contentEl.querySelector(".review-progress-text")!.textContent === "1 / 2 viewed", "progress update");
    expect(Object.keys(readViewed("/fake/vault"))).toEqual(["agent.ts"]);
    expect(view.contentEl.querySelector(".review-file-row.is-viewed")).not.toBeNull();
  });

  it("commits exactly the selected files through reset → add → commit", async () => {
    const { app, bridge } = await reviewApp();
    await openGitReview(app);
    const view = app.workspace.getLeavesOfType(GitReviewView.VIEW_TYPE)[0].view as GitReviewView;
    await until(() => view.contentEl.querySelectorAll(".review-include-checkbox").length === 2, "include checkboxes");

    // Deselect notes.md, keep agent.ts.
    const checkboxes = [...view.contentEl.querySelectorAll<HTMLInputElement>(".review-include-checkbox")];
    checkboxes[1].click();
    await until(() => view.contentEl.querySelector(".review-commit-meta")!.textContent === "1 of 2 files selected", "selection count");

    setInputValue(view.contentEl.querySelector(".review-commit-subject") as HTMLInputElement, "feat: agent edges");
    const button = view.contentEl.querySelector(".review-commit-button") as HTMLButtonElement;
    await until(() => !button.disabled, "commit enabled");
    button.click();
    await until(() => bridge.calls.some((call) => call[0] === "commit"), "commit call");

    expect(bridge.calls).toContainEqual(["reset", "-q"]);
    expect(bridge.calls).toContainEqual(["add", "--", "agent.ts"]);
    expect(bridge.calls).toContainEqual(["commit", "-m", "feat: agent edges"]);
  });

  it("drafts an inline comment from the gutter and offers markdown export", async () => {
    const { app } = await reviewApp();
    await openGitReview(app);
    const view = app.workspace.getLeavesOfType(GitReviewView.VIEW_TYPE)[0].view as GitReviewView;
    await until(() => view.contentEl.querySelectorAll(".review-add-comment").length === 2, "gutter buttons");

    const addButton = view.contentEl.querySelector('[data-gutter="agent.ts"] .review-add-comment') as HTMLButtonElement;
    addButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await until(() => view.contentEl.querySelector(".review-comment-input") !== null, "draft editor");

    setInputValue(view.contentEl.querySelector(".review-comment-input") as HTMLTextAreaElement, "Should notify be async?");
    const save = [...view.contentEl.querySelectorAll<HTMLButtonElement>(".review-comment-actions .review-card-action")]
      .find((el) => el.textContent === "Save")!;
    await until(() => !save.disabled, "save enabled");
    save.click();

    await until(
      () => [...view.contentEl.querySelectorAll(".review-action")].some((el) => el.textContent?.includes("Copy 1 note")),
      "copy-notes action",
    );
    expect(view.contentEl.querySelector(".review-comment-body")!.textContent).toBe("Should notify be async?");
  });
});
