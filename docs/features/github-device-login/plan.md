=== Contract ===

# Task Contract: GitHub Device Login

## Intent

Add the browser-based GitHub Device Flow used by the installed Oh My GitHub
application as the primary cloud-login path. Keep the existing personal token
flow as a fallback and continue storing the resulting token in SecretStorage.

## Current State

The GitHub workspace accepts only a pasted personal access token. Its new
"Continue on GitHub" action opens the token-creation page; it does not authorize
the application or return a token.

## Must

- pnpm is the only package manager; a preinstall hook rejects npm and yarn.
- Fail fast on product paths: a missing configuration raises an explicit
- The full vitest suite is green before any merge.
- Keep the perf budget on the 20k-file vault: openFile median under 50ms
- Code stays name-agnostic: no product-name literal appears anywhere in the

## Must NOT

- Do not add a production dependency without a goal contract that adopts it.
- Do not weaken, skip, or delete an existing test to make a gate pass.
- Do not source a default from anywhere but the user's explicit configuration.

## Decisions

- One app, one package: the repo root is the single application package; its
- The native seam is ports-and-adapters: the shell fills the ports the renderer
- Dual-track plugin architecture: `builtin/` is the internal track and may use
- Kernel direction rule: `vault/`, `metadata/`, and `storage/` import only from
- Disk access stays in-process behind the `DataAdapter` seam in the renderer
- Unit tests are centralized under `tests/` (workspace member), mirroring
- The docs household is docwright goals under
- Use GitHub's OAuth Device Flow endpoints with a build-provided
- Request only `repo`, `notifications`, and `read:user`, then verify the returned
- Route OAuth requests through the existing `GitHubService.transportFactory`
- Poll at GitHub's returned interval, add five seconds after `slow_down`, stop at
- Render "Login with GitHub" as the primary action, the user code plus a browser
- If no OAuth client ID was supplied at build time, disable the primary action,

## Boundaries

Allowed changes:

- src/renderer/builtin/github/GitHubService.ts
- src/renderer/builtin/github/GitPrViews.ts
- src/renderer/styles/product/git-prs.css
- src/renderer/vite-env.d.ts
- tests/web/builtin/github/**
- docs/features/github-device-login/**
  Forbidden:
- Do not use or import credentials from Oh My GitHub, GitHub CLI, or another application.
- Do not add production dependencies or new IPC channels.
- Do not persist a device code, pending session, or rejected access token.
- Do not remove personal-token login.
  Out of scope:
- Registering or administering the GitHub OAuth App.
- Multiple GitHub accounts and account switching.
- GitHub Enterprise device-flow hosts.
- Proxy and custom-CA settings beyond the existing request transport.

## Completion Criteria

Rule: device-login — Browser authorization is the primary login path
Scenario: GitHub device authorization signs the user in (critical)
Test:
Filter: completes GitHub device login and stores the returned token
Given a configured OAuth client ID and GitHub device endpoints returning a user code then an access token
When the device login service starts and completes authorization
Then it sends the configured scopes, verifies the returned token, and stores that token in SecretStorage

Scenario: Pending authorization respects GitHub polling responses
Test:
Filter: waits through pending and slow-down device responses
Given GitHub returns `authorization_pending`, `slow_down`, and then an access token
When the device login service polls for completion
Then polling continues and the next wait includes GitHub's five-second slow-down increment

Scenario: Rejected authorization stores no token
Test:
Filter: rejects denied device login without storing a token
Given GitHub returns `access_denied` for a pending device authorization
When the device login service polls for completion
Then it returns the GitHub error and SecretStorage remains empty

Rule: login-surface — OAuth and PAT remain explicit alternatives
Scenario: Login view opens GitHub device verification
Test:
Filter: opens browser device login from the signed-out view
Given the GitHub workspace is signed out and an OAuth client ID is configured
When the user chooses the primary GitHub login and then the browser action
Then the view shows the user code and opens GitHub's verification URL

Scenario: Missing OAuth configuration preserves PAT login
Test:
Filter: keeps personal-token login available without an OAuth client ID
Given the GitHub workspace is signed out and no OAuth client ID is configured
When the sign-in view renders
Then the primary GitHub login is disabled, the missing-client message is visible, and the PAT form remains reachable

=== Codebase Context ===

Files (8):

- docs/features/github-device-login/spec.md
- tests/web/builtin/github/GitHubClient.test.ts
- tests/web/builtin/github/GitHubWorkspace.test.tsx
- tests/web/builtin/github/GitPrViews.test.tsx
- tests/web/builtin/github/commits.test.ts
- tests/web/builtin/github/extraApi.test.ts
- tests/web/builtin/github/patchUtils.test.ts
- tests/web/builtin/github/resolveRepository.test.ts

=== Task Sketch ===

Group 1 (order 1):
Scenarios: - GitHub device authorization signs the user in (critical) - Pending authorization respects GitHub polling responses - Rejected authorization stores no token - Login view opens GitHub device verification - Missing OAuth configuration preserves PAT login
Boundary paths: - src/renderer/builtin/github/GitHubService.ts - src/renderer/builtin/github/GitPrViews.ts - src/renderer/styles/product/git-prs.css - src/renderer/vite-env.d.ts - tests/web/builtin/github/** - docs/features/github-device-login/**
Test selectors: - completes GitHub device login and stores the returned token - waits through pending and slow-down device responses - rejects denied device login without storing a token - opens browser device login from the signed-out view - keeps personal-token login available without an OAuth client ID

=== Warnings ===

- Allowed Changes path not found: src/renderer/vite-env.d.ts (resolved to ./src/renderer/vite-env.d.ts)
