spec: task
name: "GitHub Device Login"
inherits: project
tags: [feature, github, auth]
estimate: 0.5d
test_command: pnpm vitest run -t "{selectors}" --reporter=junit --outputFile=.docwright/report.xml
test_report: .docwright/report.xml
---

## Intent

Add the browser-based GitHub Device Flow used by the installed Oh My GitHub
application as the primary cloud-login path. Keep the existing personal token
flow as a fallback and continue storing the resulting token in SecretStorage.

## Current State

The GitHub workspace accepts only a pasted personal access token. Its new
"Continue on GitHub" action opens the token-creation page; it does not authorize
the application or return a token.

## Decisions

- Use GitHub's OAuth Device Flow endpoints with a build-provided
  `VITE_GITHUB_OAUTH_CLIENT_ID`; no client secret or callback server is added.
- Request only `repo`, `notifications`, and `read:user`, then verify the returned
  access token through the existing `GitHubClient.getAuth()` path.
- Route OAuth requests through the existing `GitHubService.transportFactory`
  and desktop `request-url` bridge; add no IPC channel or dependency.
- Poll at GitHub's returned interval, add five seconds after `slow_down`, stop at
  expiry or abort, and persist a token only after GitHub returns success.
- Render "Login with GitHub" as the primary action, the user code plus a browser
  action while authorization is pending, and the current PAT form behind a
  secondary fallback action.
- If no OAuth client ID was supplied at build time, disable the primary action,
  explain the missing configuration, and leave PAT login usable.

## Boundaries

### Allowed Changes

- src/renderer/builtin/github/GitHubService.ts
- src/renderer/builtin/github/GitPrViews.ts
- src/renderer/styles/product/git-prs.css
- tests/web/builtin/github/**
- docs/features/github-device-login/**

### Forbidden

- Do not use or import credentials from Oh My GitHub, GitHub CLI, or another application.
- Do not add production dependencies or new IPC channels.
- Do not persist a device code, pending session, or rejected access token.
- Do not remove personal-token login.

## Completion Criteria

### Rule: device-login — Browser authorization is the primary login path

Scenario: GitHub device authorization signs the user in (critical)
Tags: critical
Test: completes GitHub device login and stores the returned token
Given a configured OAuth client ID and GitHub device endpoints returning a user code then an access token
When the device login service starts and completes authorization
Then it sends the configured scopes, verifies the returned token, and stores that token in SecretStorage

Scenario: Pending authorization respects GitHub polling responses
Test: waits through pending and slow-down device responses
Given GitHub returns `authorization_pending`, `slow_down`, and then an access token
When the device login service polls for completion
Then polling continues and the next wait includes GitHub's five-second slow-down increment

Scenario: Rejected authorization stores no token
Test: rejects denied device login without storing a token
Given GitHub returns `access_denied` for a pending device authorization
When the device login service polls for completion
Then it returns the GitHub error and SecretStorage remains empty

### Rule: login-surface — OAuth and PAT remain explicit alternatives

Scenario: Login view opens GitHub device verification
Test: opens browser device login from the signed-out view
Given the GitHub workspace is signed out and an OAuth client ID is configured
When the user chooses the primary GitHub login and then the browser action
Then the view shows the user code and opens GitHub's verification URL

Scenario: Missing OAuth configuration preserves PAT login
Test: keeps personal-token login available without an OAuth client ID
Given the GitHub workspace is signed out and no OAuth client ID is configured
When the sign-in view renders
Then the primary GitHub login is disabled, the missing-client message is visible, and the PAT form remains reachable

## Out of Scope

- Registering or administering the GitHub OAuth App.
- Multiple GitHub accounts and account switching.
- GitHub Enterprise device-flow hosts.
- Proxy and custom-CA settings beyond the existing request transport.

## Open Questions

None.
