import { describe, expect, it } from "vitest";
import type { HttpTransport } from "@web/builtin/github/GitHubClient";
import { GitHubGraphQLClient, graphqlUrlForHost } from "@web/builtin/github/GitHubGraphQL";

/** Captures what was asked as well as answering it — a mapper test that never
 * inspects the request would pass on a query aimed at the wrong endpoint. */
function mock(payload: unknown, status = 200) {
  const sent: { url?: string; body?: string; auth?: string } = {};
  const transport: HttpTransport = async ({ url, body, headers }) => {
    sent.url = url;
    sent.body = body;
    sent.auth = headers?.Authorization;
    return { status, text: "", json: payload };
  };
  return { transport, sent };
}

/** Shaped from a real response: `gh api graphql` against the live schema on
 * 2026-07-17 returned exactly these fields, including all five
 * `contributionLevel` values. */
const CONTRIBUTIONS_PAYLOAD = {
  data: {
    user: {
      contributionsCollection: {
        restrictedContributionsCount: 3,
        totalCommitContributions: 99,
        totalIssueContributions: 1,
        totalPullRequestContributions: 17,
        totalPullRequestReviewContributions: 0,
        contributionCalendar: {
          totalContributions: 136,
          weeks: [
            {
              firstDay: "2026-01-04",
              contributionDays: [
                { date: "2026-01-04", contributionCount: 0, contributionLevel: "NONE" },
                { date: "2026-01-05", contributionCount: 2, contributionLevel: "FIRST_QUARTILE" },
                { date: "2026-01-06", contributionCount: 5, contributionLevel: "SECOND_QUARTILE" },
                { date: "2026-01-07", contributionCount: 9, contributionLevel: "THIRD_QUARTILE" },
                { date: "2026-01-08", contributionCount: 21, contributionLevel: "FOURTH_QUARTILE" },
              ],
            },
          ],
        },
      },
    },
  },
};

describe("graphqlUrlForHost", () => {
  it("uses the api host for github.com", () => {
    expect(graphqlUrlForHost("github.com")).toBe("https://api.github.com/graphql");
  });

  it("uses /api/graphql on Enterprise — not the REST /api/v3 root", () => {
    expect(graphqlUrlForHost("github.acme.com")).toBe("https://github.acme.com/api/graphql");
  });
});

describe("GitHubGraphQLClient.getContributions", () => {
  it("maps GitHub's quartile enum to the view's 0-4 scale", async () => {
    const { transport } = mock(CONTRIBUTIONS_PAYLOAD);
    const client = new GitHubGraphQLClient(transport, "token");

    const calendar = await client.getContributions("octocat", 2026);

    expect(calendar.weeks[0].days.map((d) => d.level)).toEqual([0, 1, 2, 3, 4]);
    expect(calendar.weeks[0].days[4]).toEqual({
      date: "2026-01-08",
      count: 21,
      level: 4,
    });
  });

  it("carries the totals the head line and the four tiles render", async () => {
    const { transport } = mock(CONTRIBUTIONS_PAYLOAD);
    const client = new GitHubGraphQLClient(transport, "token");

    const calendar = await client.getContributions("octocat", 2026);

    expect(calendar.year).toBe(2026);
    expect(calendar.totalContributions).toBe(136);
    expect(calendar.restrictedContributions).toBe(3);
    expect(calendar.stats).toEqual({
      commits: 99,
      pullRequests: 17,
      codeReviews: 0,
      issues: 1,
    });
  });

  it("asks for the requested year's window", async () => {
    const { transport, sent } = mock(CONTRIBUTIONS_PAYLOAD);
    const client = new GitHubGraphQLClient(transport, "token");

    await client.getContributions("octocat", 2024);

    const body = JSON.parse(sent.body ?? "{}") as { variables: Record<string, string> };
    expect(body.variables.from).toBe("2024-01-01T00:00:00Z");
    expect(body.variables.to).toBe("2024-12-31T23:59:59Z");
    expect(sent.url).toBe("https://api.github.com/graphql");
    expect(sent.auth).toBe("Bearer token");
  });

  it("survives a year with no contributions rather than throwing", async () => {
    const { transport } = mock({ data: { user: { contributionsCollection: null } } });
    const client = new GitHubGraphQLClient(transport, "token");

    const calendar = await client.getContributions("octocat", 2019);

    expect(calendar.totalContributions).toBe(0);
    expect(calendar.weeks).toEqual([]);
    expect(calendar.stats.commits).toBe(0);
  });
});

describe("GitHubGraphQLClient.getProfileOverview", () => {
  const PINNED_NODE = {
    name: "ghostty-web",
    nameWithOwner: "coder/ghostty-web",
    owner: { login: "coder" },
    description: "A terminal",
    isPrivate: false,
    primaryLanguage: { name: "Zig", color: "#ec915c" },
    stargazerCount: 12,
    forkCount: 3,
    url: "https://github.com/coder/ghostty-web",
  };

  it("maps a pinned repository into a card", async () => {
    const { transport } = mock({
      data: {
        user: {
          contributionsCollection: { contributionYears: [2024, 2026, 2025] },
          pinnedItems: { nodes: [PINNED_NODE] },
        },
      },
    });
    const client = new GitHubGraphQLClient(transport, "token");

    const { pinned } = await client.getProfileOverview("octocat", false);

    expect(pinned).toEqual([
      {
        owner: "coder",
        repo: "ghostty-web",
        nameWithOwner: "coder/ghostty-web",
        description: "A terminal",
        language: "Zig",
        languageColor: "#ec915c",
        stars: 12,
        forks: 3,
        isPrivate: false,
        url: "https://github.com/coder/ghostty-web",
      },
    ]);
  });

  it("hands the year picker newest first", async () => {
    const { transport } = mock({
      data: {
        user: {
          contributionsCollection: { contributionYears: [2024, 2026, 2025] },
          pinnedItems: { nodes: [] },
        },
      },
    });
    const client = new GitHubGraphQLClient(transport, "token");

    const { contributionYears } = await client.getProfileOverview("octocat", false);

    expect(contributionYears).toEqual([2026, 2025, 2024]);
  });

  it("asks an organization a query that never mentions contributions", async () => {
    const { transport, sent } = mock({
      data: { organization: { pinnedItems: { nodes: [PINNED_NODE] } } },
    });
    const client = new GitHubGraphQLClient(transport, "token");

    const { pinned, contributionYears } = await client.getProfileOverview("acme", true);

    // The Organization type has no contributionsCollection at all — asking for
    // one would make the whole query fail, taking the pinned grid with it.
    const body = JSON.parse(sent.body ?? "{}") as { query: string };
    expect(body.query).toContain("organization(login:");
    expect(body.query).not.toContain("contributionsCollection");
    expect(pinned).toHaveLength(1);
    expect(contributionYears).toEqual([]);
  });

  it("drops the nulls GraphQL pads a pinned list with", async () => {
    const { transport } = mock({
      data: {
        user: {
          contributionsCollection: { contributionYears: [] },
          pinnedItems: { nodes: [null, PINNED_NODE, null] },
        },
      },
    });
    const client = new GitHubGraphQLClient(transport, "token");

    const { pinned } = await client.getProfileOverview("octocat", false);

    expect(pinned).toHaveLength(1);
  });
});

describe("GitHubGraphQLClient errors", () => {
  it("raises the errors GraphQL reports inside a 200", async () => {
    // GraphQL answers 200 with an errors array; a status check alone would hand
    // the view an empty profile and call it a success.
    const { transport } = mock({
      data: null,
      errors: [{ message: "Could not resolve to a User with the login of 'nope'." }],
    });
    const client = new GitHubGraphQLClient(transport, "token");

    await expect(client.getProfileOverview("nope", false)).rejects.toThrow(
      /Could not resolve to a User/,
    );
  });

  it("reports GitHub's message on an HTTP failure", async () => {
    const { transport } = mock({ message: "Bad credentials" }, 401);
    const client = new GitHubGraphQLClient(transport, "token");

    await expect(client.getContributions("octocat", 2026)).rejects.toThrow(/Bad credentials/);
  });

  it("refuses to call GraphQL without a token", async () => {
    const { transport, sent } = mock({ data: {} });
    const client = new GitHubGraphQLClient(transport, null);

    await expect(client.getContributions("octocat", 2026)).rejects.toThrow(/Not authenticated/);
    expect(sent.url).toBeUndefined();
  });
});
