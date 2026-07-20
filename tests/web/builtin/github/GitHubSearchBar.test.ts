import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { Platform } from "@web/platform/Platform";
import {
  filterGitHubSearchSuggestions,
  GitHubSearchBar,
  type GitHubSearchSuggestion,
} from "../../../../apps/web/builtin/github/GitHubSearchBar";
import type { GithubRepoListItem } from "../../../../apps/web/builtin/github/GitHubService";
import * as open from "../../../../apps/web/builtin/github/open";
import { GitHubListView } from "../../../../apps/web/builtin/github/GitHubListView";

const repos: GithubRepoListItem[] = [
  {
    owner: "acme",
    repo: "attention",
    fullName: "acme/attention",
    private: false,
    description: "Obsidian-native shell",
    openIssues: 3,
  },
  {
    owner: "acme",
    repo: "raft",
    fullName: "acme/raft",
    private: true,
    description: null,
    openIssues: 0,
  },
  {
    owner: "other",
    repo: "notes",
    fullName: "other/notes",
    private: false,
    description: "personal vault",
    openIssues: 1,
  },
];

describe("filterGitHubSearchSuggestions", () => {
  it("returns fixed destinations and repos when the query is empty", () => {
    const items = filterGitHubSearchSuggestions("", repos, ["acme"]);
    expect(items.some((item) => item.kind === "inbox")).toBe(true);
    expect(items.some((item) => item.kind === "query" && item.query === "review-requested")).toBe(
      true,
    );
    expect(items.filter((item) => item.kind === "repo")).toHaveLength(3);
    expect(items.some((item) => item.kind === "org" && item.login === "acme")).toBe(true);
  });

  it("filters repositories by full name and description", () => {
    const byName = filterGitHubSearchSuggestions("raft", repos);
    expect(
      byName
        .filter(
          (item): item is Extract<GitHubSearchSuggestion, { kind: "repo" }> => item.kind === "repo",
        )
        .map((item) => item.fullName),
    ).toEqual(["acme/raft"]);

    const byDesc = filterGitHubSearchSuggestions("obsidian", repos);
    expect(
      byDesc
        .filter(
          (item): item is Extract<GitHubSearchSuggestion, { kind: "repo" }> => item.kind === "repo",
        )
        .map((item) => item.fullName),
    ).toEqual(["acme/attention"]);
  });

  it("filters fixed queries and inbox by label", () => {
    const needs = filterGitHubSearchSuggestions("needs", repos);
    expect(needs.some((item) => item.kind === "query" && item.query === "review-requested")).toBe(
      true,
    );
    expect(needs.some((item) => item.kind === "repo")).toBe(false);

    const inbox = filterGitHubSearchSuggestions("notif", repos);
    expect(inbox.some((item) => item.kind === "inbox")).toBe(true);
  });
});

describe("GitHubSearchBar behavior", () => {
  let root: HTMLElement;

  afterEach(() => {
    root?.remove();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  async function bootApp(): Promise<App> {
    root = document.createElement("div");
    document.body.appendChild(root);
    const app = new App(root);
    await app.ready;
    return app;
  }

  function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function until(predicate: () => boolean, label: string, ms = 1000): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > ms) throw new Error(`timed out waiting for ${label}`);
      await settle();
    }
  }

  function fakeView(): { contentEl: HTMLElement } {
    const contentEl = document.createElement("div");
    document.body.appendChild(contentEl);
    return { contentEl };
  }

  function quietNetwork(app: App): void {
    vi.spyOn(app.github, "listUserRepositories").mockResolvedValue([]);
    vi.spyOn(app.github, "listUserOrganizations").mockResolvedValue([]);
    vi.spyOn(app.github, "getAuth").mockResolvedValue({
      hasToken: false,
      login: null,
      avatarUrl: null,
      name: null,
    });
  }

  it("summons the bar on the leaf and dismisses it on escape", async () => {
    const app = await bootApp();
    quietNetwork(app);
    const view = fakeView();

    GitHubSearchBar.toggle(app, view);
    const container = view.contentEl.querySelector(".document-search-container");
    // The host's own search chrome, mounted on the leaf it was summoned from.
    expect(container).not.toBeNull();
    expect(view.contentEl.querySelector(".document-search-input")).not.toBeNull();

    const input = view.contentEl.querySelector(".document-search-input") as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    // Gone without a trace — not merely hidden.
    expect(view.contentEl.querySelector(".document-search-container")).toBeNull();
    expect(GitHubSearchBar.isOpen(view)).toBe(false);
  });

  // The wiring, not just the bar: ⌘F must arrive through the real keymap. A
  // global ⌘F command could not do this — the dispatcher stops at the first
  // match and drops checkCallback's verdict — so the key rides the view's own
  // scope instead.
  it("summons the bar from a real cmd-F on the active GitHub leaf", async () => {
    const app = await bootApp();
    quietNetwork(app);
    vi.spyOn(app.github, "searchInvolvement").mockResolvedValue([]);
    await open.openQueryList(app, "pr", "created");
    const view = app.workspace.getLeavesOfType(GitHubListView.VIEW_TYPE)[0].view as unknown as {
      contentEl: HTMLElement;
    };
    expect(view.contentEl.querySelector(".document-search-container")).toBeNull();

    // Exactly one modifier: Mod normalizes to Meta on macOS and Ctrl elsewhere,
    // and setting both yields a modifier string that matches neither.
    app.keymap.handleKey(
      new KeyboardEvent("keydown", {
        key: "f",
        [Platform.isMacOS ? "metaKey" : "ctrlKey"]: true,
        bubbles: true,
      }),
    );
    expect(view.contentEl.querySelector(".document-search-input")).not.toBeNull();
  });

  it("toggles rather than stacking a second bar on the same leaf", async () => {
    const app = await bootApp();
    quietNetwork(app);
    const view = fakeView();

    GitHubSearchBar.toggle(app, view);
    GitHubSearchBar.toggle(app, view);
    expect(view.contentEl.querySelectorAll(".document-search-container")).toHaveLength(0);

    GitHubSearchBar.toggle(app, view);
    expect(view.contentEl.querySelectorAll(".document-search-container")).toHaveLength(1);
  });

  it("loads fixed suggestions immediately and fills repos independently", async () => {
    const app = await bootApp();
    let releaseRepos!: (value: GithubRepoListItem[]) => void;
    vi.spyOn(app.github, "listUserRepositories").mockReturnValue(
      new Promise((resolve) => {
        releaseRepos = resolve;
      }),
    );
    vi.spyOn(app.github, "listUserOrganizations").mockRejectedValue(new Error("orgs down"));
    vi.spyOn(app.github, "getAuth").mockResolvedValue({
      hasToken: true,
      login: "ada",
      avatarUrl: null,
      name: "Ada",
    });

    const bar = GitHubSearchBar.toggle(app, fakeView())!;
    await settle();
    // Fixed destinations available before the network settles.
    expect(bar.suggestionsFor("").some((item) => item.kind === "inbox")).toBe(true);
    expect(bar.suggestionsFor("").some((item) => item.kind === "query")).toBe(true);
    expect(bar.suggestionsFor("").some((item) => item.kind === "repo")).toBe(false);

    releaseRepos([repos[0]!]);
    await until(() => bar.suggestionsFor("").some((item) => item.kind === "repo"), "repos");
    // Org API failed but the signed-in user still appears.
    expect(bar.suggestionsFor("").some((item) => item.kind === "org" && item.login === "ada")).toBe(
      true,
    );
    bar.close();
  });

  it("ignores late network replies after the bar is dismissed", async () => {
    const app = await bootApp();
    let releaseRepos!: (value: GithubRepoListItem[]) => void;
    vi.spyOn(app.github, "listUserRepositories").mockReturnValue(
      new Promise((resolve) => {
        releaseRepos = resolve;
      }),
    );
    vi.spyOn(app.github, "listUserOrganizations").mockResolvedValue([]);
    vi.spyOn(app.github, "getAuth").mockResolvedValue({
      hasToken: true,
      login: "ada",
      avatarUrl: null,
      name: null,
    });

    const bar = GitHubSearchBar.toggle(app, fakeView())!;
    await settle();
    bar.close();
    releaseRepos([repos[0]!]);
    await settle();
    // A reply landing after dismissal must not fill a bar that is gone.
    expect(bar.suggestionsFor("").some((item) => item.kind === "repo")).toBe(false);
  });

  it("routes choices through the open helpers and honors mod-open", async () => {
    const app = await bootApp();
    vi.spyOn(app.github, "listUserRepositories").mockResolvedValue([repos[0]!]);
    vi.spyOn(app.github, "listUserOrganizations").mockResolvedValue([]);
    vi.spyOn(app.github, "getAuth").mockResolvedValue({
      hasToken: true,
      login: "ada",
      avatarUrl: null,
      name: null,
    });
    const openRepo = vi.spyOn(open, "openRepo").mockResolvedValue();
    const openQuery = vi.spyOn(open, "openQueryList").mockResolvedValue();
    const openInbox = vi.spyOn(open, "openInbox").mockResolvedValue();

    const view = fakeView();
    const bar = GitHubSearchBar.toggle(app, view)!;
    await until(() => bar.suggestionsFor("attention").some((item) => item.kind === "repo"), "repo");

    const repoItem = bar
      .suggestionsFor("attention")
      .find(
        (item): item is Extract<GitHubSearchSuggestion, { kind: "repo" }> => item.kind === "repo",
      )!;
    bar.choose(repoItem, new MouseEvent("click", { metaKey: true, ctrlKey: true }));
    expect(openRepo).toHaveBeenCalledWith(app, "acme", "attention", "overview", expect.anything());
    // Choosing finishes the search: the bar leaves with it.
    expect(view.contentEl.querySelector(".document-search-container")).toBeNull();

    const bar2 = GitHubSearchBar.toggle(app, view)!;
    await settle();
    const queryItem = bar2
      .suggestionsFor("needs")
      .find(
        (item): item is Extract<GitHubSearchSuggestion, { kind: "query" }> =>
          item.kind === "query" && item.query === "review-requested",
      )!;
    bar2.choose(queryItem, new MouseEvent("click"));
    expect(openQuery).toHaveBeenCalledWith(app, "pr", "review-requested", false);

    const bar3 = GitHubSearchBar.toggle(app, view)!;
    await settle();
    const inboxItem = bar3
      .suggestionsFor("")
      .find(
        (item): item is Extract<GitHubSearchSuggestion, { kind: "inbox" }> => item.kind === "inbox",
      )!;
    bar3.choose(inboxItem, new MouseEvent("click"));
    expect(openInbox).toHaveBeenCalledWith(app, false);
  });
});
