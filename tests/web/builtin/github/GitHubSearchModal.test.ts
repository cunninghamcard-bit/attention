import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import {
  filterGitHubSearchSuggestions,
  GitHubSearchModal,
  type GitHubSearchSuggestion,
} from "../../../../src/renderer/builtin/github/GitHubSearchModal";
import type { GithubRepoListItem } from "../../../../src/renderer/builtin/github/GitHubService";
import * as open from "../../../../src/renderer/builtin/github/open";

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

describe("GitHubSearchModal behavior", () => {
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

    const modal = new GitHubSearchModal(app);
    modal.open();
    await settle();
    // Fixed destinations available before network settles.
    expect(modal.getSuggestions("").some((item) => item.kind === "inbox")).toBe(true);
    expect(modal.getSuggestions("").some((item) => item.kind === "query")).toBe(true);
    expect(modal.getSuggestions("").some((item) => item.kind === "repo")).toBe(false);

    releaseRepos([repos[0]!]);
    await until(() => modal.getSuggestions("").some((item) => item.kind === "repo"), "repos");
    // Org API failed but signed-in user still appears.
    expect(
      modal.getSuggestions("").some((item) => item.kind === "org" && item.login === "ada"),
    ).toBe(true);
    modal.close();
  });

  it("ignores late network replies after the modal is closed", async () => {
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

    const modal = new GitHubSearchModal(app);
    modal.open();
    await settle();
    modal.close();
    const update = vi.spyOn(modal, "updateSuggestions");
    releaseRepos([repos[0]!]);
    await settle();
    expect(update).not.toHaveBeenCalled();
    expect(modal.getSuggestions("").some((item) => item.kind === "repo")).toBe(false);
  });

  it("routes choices through open helpers and honors mod-open", async () => {
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

    const modal = new GitHubSearchModal(app);
    modal.open();
    await until(
      () => modal.getSuggestions("attention").some((item) => item.kind === "repo"),
      "repo",
    );

    const repoItem = modal
      .getSuggestions("attention")
      .find(
        (item): item is Extract<GitHubSearchSuggestion, { kind: "repo" }> => item.kind === "repo",
      )!;
    modal.onChooseSuggestion(repoItem, new MouseEvent("click", { metaKey: true, ctrlKey: true }));
    expect(openRepo).toHaveBeenCalledWith(app, "acme", "attention", "overview", expect.anything());

    const queryItem = modal
      .getSuggestions("needs")
      .find(
        (item): item is Extract<GitHubSearchSuggestion, { kind: "query" }> =>
          item.kind === "query" && item.query === "review-requested",
      )!;
    modal.onChooseSuggestion(queryItem, new MouseEvent("click"));
    expect(openQuery).toHaveBeenCalledWith(app, "pr", "review-requested", false);

    const inboxItem = modal
      .getSuggestions("")
      .find(
        (item): item is Extract<GitHubSearchSuggestion, { kind: "inbox" }> => item.kind === "inbox",
      )!;
    modal.onChooseSuggestion(inboxItem, new MouseEvent("click"));
    expect(openInbox).toHaveBeenCalledWith(app, false);
    modal.close();
  });

  it("renders suggestion nodes into the row ownerDocument", async () => {
    const app = await bootApp();
    vi.spyOn(app.github, "listUserRepositories").mockResolvedValue([]);
    vi.spyOn(app.github, "listUserOrganizations").mockResolvedValue([]);
    vi.spyOn(app.github, "getAuth").mockResolvedValue({
      hasToken: false,
      login: null,
      avatarUrl: null,
      name: null,
    });
    const modal = new GitHubSearchModal(app);
    modal.open();
    const row = modal.containerEl.ownerDocument.createElement("div");
    modal.renderSuggestion({ kind: "inbox", label: "Inbox" }, row);
    expect(row.querySelector(".suggestion-title")?.textContent).toBe("Inbox");
    expect(row.querySelector(".suggestion-flair")).not.toBeNull();
    modal.close();
  });
});
