import { describe, expect, it } from "vitest";
import { App } from "@web/app/App";
import type { HttpResponse, HttpTransport } from "@web/builtin/github/GitHubClient";

function response(json: unknown, status = 200): HttpResponse {
  return { status, text: JSON.stringify(json), json };
}

function deviceApp(tokenResponses: unknown[]): {
  app: App;
  calls: Array<{ url: string; body: string }>;
  waits: number[];
} {
  const app = new App(document.createElement("div"));
  const calls: Array<{ url: string; body: string }> = [];
  const waits: number[] = [];
  app.github.clearToken();
  app.github.oauthClientId = "test-client-id";
  app.github.sleep = async (ms) => {
    waits.push(ms);
  };
  app.github.transportFactory =
    (): HttpTransport =>
    async ({ url, body = "" }) => {
      calls.push({ url, body });
      if (url.endsWith("/login/device/code")) {
        return response({
          device_code: "device-code",
          user_code: "ABCD-EFGH",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 2,
        });
      }
      if (url.endsWith("/login/oauth/access_token")) {
        return response(tokenResponses.shift() ?? { error: "expired_token" });
      }
      if (url.endsWith("/user")) {
        return response({ login: "octocat", avatar_url: "", name: "Octocat" });
      }
      throw new Error(`Unexpected request: ${url}`);
    };
  return { app, calls, waits };
}

describe("GitHubService device login", () => {
  it("completes GitHub device login and stores the returned token", async () => {
    const { app, calls } = deviceApp([{ access_token: "oauth-token", token_type: "bearer" }]);

    const session = await app.github.startDeviceLogin();
    const auth = await app.github.completeDeviceLogin(session);

    expect(auth).toMatchObject({ login: "octocat" });
    expect(app.secretStorage.getSecret("github-token")).toBe("oauth-token");
    expect(calls[0].body).toContain("client_id=test-client-id");
    expect(new URLSearchParams(calls[0].body).get("scope")).toBe("repo notifications read:user");
  });

  it("waits through pending and slow-down device responses", async () => {
    const { app, waits } = deviceApp([
      { error: "authorization_pending" },
      { error: "slow_down" },
      { access_token: "oauth-token" },
    ]);

    const session = await app.github.startDeviceLogin();
    await app.github.completeDeviceLogin(session);

    expect(waits).toEqual([2_000, 2_000, 7_000]);
  });

  it("rejects denied device login without storing a token", async () => {
    const { app } = deviceApp([
      { error: "access_denied", error_description: "The user denied the request." },
    ]);

    const session = await app.github.startDeviceLogin();
    const result = await app.github.completeDeviceLogin(session);

    expect(result).toEqual({ error: "The user denied the request." });
    expect(app.secretStorage.getSecret("github-token")).toBeFalsy();
  });
});
