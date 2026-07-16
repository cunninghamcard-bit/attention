import { describe, expect, it } from "vitest";
import { matchNotifications } from "@web/builtin/github/GitHubListView";
import type { NotificationItem } from "@web/builtin/github/types";

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
