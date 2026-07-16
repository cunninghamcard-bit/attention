import { describe, expect, it } from "vitest";
import { matchNotifications, matchSearchItems } from "@web/builtin/github/GitHubListView";
import type { GitHubSearchItem, NotificationItem } from "@web/builtin/github/types";

const item = (over: Partial<NotificationItem>): NotificationItem => ({
  id: "n",
  unread: true,
  reason: "mention",
  updatedAt: "",
  title: "Fix the thing",
  type: "Issue",
  url: null,
  repository: "octo/notes",
  owner: "octo",
  repo: "notes",
  subjectUrl: null,
  repositoryHtmlUrl: "https://github.com/octo/notes",
  ...over,
});

describe("inbox filter language", () => {
  const items = [
    item({ id: "a", unread: true, reason: "mention", title: "Alpha", repository: "octo/notes" }),
    item({ id: "b", unread: false, reason: "assign", title: "Beta", repository: "acme/platform" }),
    item({ id: "c", unread: true, reason: "assign", title: "Gamma", repository: "acme/platform" }),
  ];
  const ids = (query: string): string[] => matchNotifications(items, query).map((i) => i.id);

  it("shows everything when the box is empty", () => {
    expect(ids("")).toEqual(["a", "b", "c"]);
  });

  it("replaces the Unread/All toggle with is:", () => {
    expect(ids("is:unread")).toEqual(["a", "c"]);
    expect(ids("is:all")).toEqual(["a", "b", "c"]);
  });

  it("replaces the reason chips with reason:", () => {
    expect(ids("reason:assign")).toEqual(["b", "c"]);
    expect(ids("reason:mention")).toEqual(["a"]);
  });

  it("offers repo:, which no chip ever did", () => {
    expect(ids("repo:acme")).toEqual(["b", "c"]);
  });

  it("composes qualifiers — the thing a button row cannot do", () => {
    // Every chip row can only offer what someone drew. This costs nothing.
    expect(ids("is:unread reason:assign")).toEqual(["c"]);
    expect(ids("is:unread repo:acme")).toEqual(["c"]);
  });

  it("still matches plain text, so typing works before learning the language", () => {
    expect(ids("alpha")).toEqual(["a"]);
    expect(ids("platform")).toEqual(["b", "c"]);
    expect(ids("is:unread gamma")).toEqual(["c"]);
  });
});

const pr = (over: Partial<GitHubSearchItem>): GitHubSearchItem => ({
  owner: "octo",
  repo: "notes",
  number: 1,
  title: "Some change",
  state: "open",
  isDraft: false,
  isPullRequest: true,
  author: { login: "ada", avatarUrl: "", url: "" },
  createdAt: "",
  updatedAt: "",
  url: "",
  labels: [],
  comments: 0,
  ...over,
});

describe("query list filter language", () => {
  const items = [
    pr({
      number: 1,
      title: "Alpha",
      state: "open",
      author: { login: "ada", avatarUrl: "", url: "" },
    }),
    pr({
      number: 2,
      title: "Beta",
      state: "closed",
      repo: "platform",
      owner: "acme",
      author: { login: "grace", avatarUrl: "", url: "" },
    }),
    pr({ number: 3, title: "Gamma", state: "open", isDraft: true }),
  ];
  const nums = (query: string): number[] => matchSearchItems(items, query).map((i) => i.number);

  it("filters by state, the qualifier form of the header control", () => {
    expect(nums("state:open")).toEqual([1, 3]);
    expect(nums("state:closed")).toEqual([2]);
  });

  it("filters by draft, repo and author", () => {
    expect(nums("is:draft")).toEqual([3]);
    expect(nums("repo:acme")).toEqual([2]);
    expect(nums("author:ada")).toEqual([1, 3]);
  });

  it("composes, and still matches plain text", () => {
    expect(nums("state:open is:draft")).toEqual([3]);
    expect(nums("alpha")).toEqual([1]);
    expect(nums("state:open alpha")).toEqual([1]);
  });
});
