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
  it("refuses to invent a URL it cannot derive", () => {
    expect(notificationWebUrl({ ...base, url: null })).toBeNull();
    expect(
      notificationWebUrl({ ...base, url: "https://api.github.com/repos/octo/notes/releases/9" }),
    ).toBeNull();
  });
});
