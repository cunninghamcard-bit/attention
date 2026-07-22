import { describe, expect, it } from "vitest";
import { App } from "@web/app/App";
import type { HttpTransport } from "@web/builtin/github/GitHubClient";

/** `app.github.getProfileOverview` is where the two halves meet: the identity
 * head comes from REST, the pinned grid and year list from GraphQL. The seam is
 * what these cover — each half has its own tests. */

function app(handler: (url: string, body: string) => unknown, status = 200) {
  const instance = new App(document.createElement("div"));
  const urls: string[] = [];
  // The service reads its token from SecretStorage; without one both halves
  // short-circuit and the seam under test never runs.
  instance.secretStorage.setSecret("github-token", "t");
  instance.github.invalidate();
  instance.github.transportFactory =
    (): HttpTransport =>
    async ({ url, body = "" }) => {
      urls.push(url);
      const json = handler(url, body);
      return { status, text: JSON.stringify(json), json };
    };
  return { instance, urls };
}

const PROFILE = {
  login: "octocat",
  name: "The Octocat",
  avatar_url: "https://avatars/1",
  bio: "hi",
  type: "User",
  followers: 5,
  following: 2,
  public_repos: 9,
  public_gists: 1,
  created_at: "2020-01-01T00:00:00Z",
  html_url: "https://github.com/octocat",
};

const ORG_PROFILE = { ...PROFILE, login: "acme", type: "Organization" };

const PINNED = {
  name: "ghostty-web",
  nameWithOwner: "coder/ghostty-web",
  owner: { login: "coder" },
  description: null,
  isPrivate: false,
  primaryLanguage: { name: "Zig", color: "#ec915c" },
  stargazerCount: 12,
  forkCount: 3,
  url: "https://github.com/coder/ghostty-web",
};

describe("app.github.getProfileOverview", () => {
  it("resolves the head over REST before asking GraphQL for the grid", async () => {
    const { instance, urls } = app((url) =>
      url.includes("/graphql")
        ? {
            data: {
              user: {
                contributionsCollection: { contributionYears: [2026] },
                pinnedItems: { nodes: [PINNED] },
              },
            },
          }
        : PROFILE,
    );

    const overview = await instance.github.getProfileOverview("octocat");

    // REST first: its `type` is what decides which GraphQL query may be asked.
    expect(urls[0]).toContain("/users/octocat");
    expect(urls[1]).toContain("/graphql");
    expect(overview.profile.isOrganization).toBe(false);
    expect(overview.pinned[0].nameWithOwner).toBe("coder/ghostty-web");
    expect(overview.contributionYears).toEqual([2026]);
  });

  it("asks an organization the query that omits contributions", async () => {
    const bodies: string[] = [];
    const { instance } = app((url, body) => {
      if (!url.includes("/graphql")) return ORG_PROFILE;
      bodies.push(body);
      return { data: { organization: { pinnedItems: { nodes: [PINNED] } } } };
    });

    const overview = await instance.github.getProfileOverview("acme");

    expect(overview.profile.isOrganization).toBe(true);
    expect(bodies[0]).toContain("organization(login:");
    expect(bodies[0]).not.toContain("contributionsCollection");
    expect(overview.contributionYears).toEqual([]);
    expect(overview.pinned).toHaveLength(1);
  });

  it("rejects when the grid fails rather than passing off an empty one", async () => {
    // An account with no pins and a query that failed must not arrive looking
    // the same — "no pinned repositories yet" is the common case (the owner's
    // own account has none), so an empty grid has to mean empty. The view owns
    // the choice between an empty state and an error state and needs the
    // difference to make it.
    const { instance } = app((url) =>
      url.includes("/graphql") ? { data: null, errors: [{ message: "rate limited" }] } : PROFILE,
    );

    await expect(instance.github.getProfileOverview("octocat")).rejects.toThrow(/rate limited/);
  });

  it("propagates a head failure — there is no page without it", async () => {
    const { instance } = app(() => ({ message: "Not Found" }), 404);

    await expect(instance.github.getProfileOverview("ghost")).rejects.toThrow();
  });
});

describe("app.github.getContributions", () => {
  it("defaults to the current year", async () => {
    const bodies: string[] = [];
    const { instance } = app((_url, body) => {
      bodies.push(body);
      return {
        data: {
          user: {
            contributionsCollection: {
              contributionCalendar: { totalContributions: 1, weeks: [] },
            },
          },
        },
      };
    });

    await instance.github.getContributions("octocat");

    const year = new Date().getFullYear();
    expect(bodies[0]).toContain(`${year}-01-01T00:00:00Z`);
  });

  it("honours an explicit year", async () => {
    const bodies: string[] = [];
    const { instance } = app((_url, body) => {
      bodies.push(body);
      return {
        data: {
          user: {
            contributionsCollection: {
              contributionCalendar: { totalContributions: 1, weeks: [] },
            },
          },
        },
      };
    });

    const calendar = await instance.github.getContributions("octocat", 2024);

    expect(bodies[0]).toContain("2024-01-01T00:00:00Z");
    expect(calendar.year).toBe(2024);
  });
});
