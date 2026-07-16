import { describe, expect, it } from "vitest";
import {
  GitHubClient,
  type HttpResponse,
  type HttpTransport,
} from "@web/builtin/github/GitHubClient";

function mock(routes: Record<string, HttpResponse>): HttpTransport {
  return async ({ url, method }) => {
    const path = url.replace(/^https:\/\/api\.github\.com/, "");
    const key = `${method ?? "GET"} ${path}`;
    return (
      routes[key] ?? { status: 404, text: `missing ${key}`, json: { message: `missing ${key}` } }
    );
  };
}

const json = (data: unknown): HttpResponse => ({ status: 200, text: "", json: data });

describe("profile REST", () => {
  it("reads a user's identity head", async () => {
    const client = new GitHubClient(
      mock({
        "GET /users/ada": json({
          login: "ada",
          name: "Ada Lovelace",
          avatar_url: "https://avatars/ada.png",
          bio: "first programmer",
          type: "User",
          followers: 3,
          following: 4,
          public_repos: 18,
          public_gists: 2,
          created_at: "2026-03-18T00:00:00Z",
          html_url: "https://github.com/ada",
        }),
      }),
      "tok",
    );

    const profile = await client.getProfile("ada");
    expect(profile).toEqual({
      login: "ada",
      name: "Ada Lovelace",
      avatarUrl: "https://avatars/ada.png",
      bio: "first programmer",
      isOrganization: false,
      followers: 3,
      following: 4,
      publicRepos: 18,
      publicGists: 2,
      createdAt: "2026-03-18T00:00:00Z",
      htmlUrl: "https://github.com/ada",
    });
  });

  // isOrganization is not cosmetic: it decides whether Stars/Followers/heatmap
  // can exist at all, so `type` must actually reach it.
  it("marks an organization from the type field", async () => {
    const client = new GitHubClient(
      mock({
        "GET /orgs-acme": json({}),
        "GET /users/acme": json({ login: "acme", type: "Organization" }),
      }),
      "tok",
    );
    const profile = await client.getProfile("acme");
    expect(profile.isOrganization).toBe(true);
    // An org legitimately has no gists/following — 0 is the API being accurate.
    expect(profile.following).toBe(0);
    expect(profile.publicGists).toBe(0);
  });

  it("maps starred repositories into the shared card shape", async () => {
    const client = new GitHubClient(
      mock({
        "GET /users/ada/starred?sort=updated&per_page=50": json([
          {
            name: "attention",
            full_name: "acme/attention",
            owner: { login: "acme" },
            description: "obsidian-native shell",
            language: "TypeScript",
            stargazers_count: 42,
            forks_count: 7,
            private: false,
            html_url: "https://github.com/acme/attention",
          },
        ]),
      }),
      "tok",
    );

    const starred = await client.listStarredRepositories("ada");
    expect(starred).toEqual([
      {
        owner: "acme",
        repo: "attention",
        nameWithOwner: "acme/attention",
        description: "obsidian-native shell",
        language: "TypeScript",
        // REST names the language but carries no colour for it — the pinned
        // grid gets its dot from GraphQL. The view renders Stars without one.
        languageColor: null,
        stars: 42,
        forks: 7,
        isPrivate: false,
        url: "https://github.com/acme/attention",
      },
    ]);
  });

  it("reads followers as the actors they are", async () => {
    const client = new GitHubClient(
      mock({
        "GET /users/ada/followers?per_page=50": json([
          {
            login: "grace",
            avatar_url: "https://avatars/grace.png",
            html_url: "https://github.com/grace",
          },
        ]),
      }),
      "tok",
    );
    expect(await client.listFollowers("ada")).toEqual([
      { login: "grace", avatarUrl: "https://avatars/grace.png", url: "https://github.com/grace" },
    ]);
  });

  it("asks for nothing when the login is blank", async () => {
    // A 404 route would throw; returning early proves no request was made.
    const client = new GitHubClient(mock({}), "tok");
    expect(await client.listStarredRepositories("  ")).toEqual([]);
    expect(await client.listFollowers("")).toEqual([]);
  });

  it("surfaces a missing account instead of inventing an empty one", async () => {
    const client = new GitHubClient(mock({}), "tok");
    await expect(client.getProfile("ghost")).rejects.toThrow();
  });
});
