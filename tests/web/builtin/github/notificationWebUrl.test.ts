import { describe, expect, it } from "vitest";
import { notificationWebUrl } from "@web/builtin/github/open";
import type { NotificationItem } from "@web/builtin/github/types";

const base: NotificationItem = {
  id: "n",
  unread: true,
  reason: "mention",
  updatedAt: "",
  title: "t",
  type: "PullRequest",
  url: null,
  repository: "octo/notes",
  owner: "octo",
  repo: "notes",
  subjectUrl: null,
  repositoryHtmlUrl: "https://github.com/octo/notes",
};

describe("notificationWebUrl", () => {
  it("maps the REST plural to the web singular", () => {
    expect(
      notificationWebUrl({ ...base, url: "https://api.github.com/repos/octo/notes/pulls/7" }),
    ).toBe("https://github.com/octo/notes/pull/7");
    expect(
      notificationWebUrl({ ...base, url: "https://api.github.com/repos/octo/notes/commits/abc" }),
    ).toBe("https://github.com/octo/notes/commit/abc");
    expect(
      notificationWebUrl({ ...base, url: "https://api.github.com/repos/octo/notes/issues/42" }),
    ).toBe("https://github.com/octo/notes/issues/42");
  });

  it("falls back to the repository page for subjects it cannot map", () => {
    // Discussion, Release, CheckSuite, null subject: no web path can be
    // derived, so use the one the payload already carries instead of inventing
    // one. This is Oh My GitHub's behaviour, verified in its source.
    expect(notificationWebUrl({ ...base, url: null })).toBe("https://github.com/octo/notes");
    expect(
      notificationWebUrl({ ...base, url: "https://api.github.com/repos/octo/notes/releases/9" }),
    ).toBe("https://github.com/octo/notes");
    expect(
      notificationWebUrl({ ...base, url: "https://api.github.com/repos/octo/notes/discussions/3" }),
    ).toBe("https://github.com/octo/notes");
  });

  it("always returns a url", () => {
    // There is no "unmappable" state for callers to handle.
    for (const url of [null, "", "nonsense", "https://api.github.com/notifications/threads/1"])
      expect(notificationWebUrl({ ...base, url })).toBeTruthy();
  });
});
