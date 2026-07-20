import type { App } from "../../app/App";
import { openInSystemBrowser } from "./widgets";
import { createDiv, createEl, createSpan } from "../../dom/dom";
import { setIcon } from "../../ui/Icon";
import type { GitHubAuthState } from "./types";

const GITHUB_TOKEN_URL =
  "https://github.com/settings/personal-access-tokens/new?name=Workbench&description=Connect%20Workbench%20GitHub%20workspace&contents=read&pull_requests=write&issues=write&actions=read";

/** Handle returned by the sign-in renderer so the host can abort a pending
 * device-login poll on close. */
export interface SignInHandle {
  destroy(): void;
}

function button(parent: HTMLElement, text?: string, cls?: string): HTMLButtonElement {
  return createEl("button", { cls, text, attr: { type: "button" } }, parent);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Renders the Connect-GitHub card (device login + personal-token fallback)
 * into `container`; calls `onAuth` once a token is accepted. Extracted from the
 * former PrListView so the left-dock navigator can host it. */
export function renderGitHubSignIn(
  container: HTMLElement,
  app: App,
  onAuth: (auth: GitHubAuthState) => void,
): SignInHandle {
  let oauthAbort: AbortController | null = null;
  const root = createDiv("git-pr-signin", container);
  const card = createDiv("git-pr-signin-card", root);
  const iconEl = createDiv("git-pr-signin-icon", card);
  setIcon(iconEl, "lucide-github");
  createEl("h2", { text: "Connect GitHub" }, card);
  createEl(
    "p",
    { text: "Connect your GitHub account to browse repositories, pull requests, and actions." },
    card,
  );
  const showError = (message: string): void => {
    card.querySelector(".git-pr-signin-error")?.remove();
    createDiv({ cls: "git-pr-error git-pr-signin-error", text: message }, card);
  };
  const oauth = button(card, "Login with GitHub", "mod-cta git-pr-signin-primary");
  oauth.disabled = !app.github.hasDeviceLogin;
  let deviceState: HTMLElement | null = null;
  let configMessage: HTMLElement | null = null;
  if (!app.github.hasDeviceLogin) {
    configMessage = createEl(
      "p",
      {
        cls: "git-pr-signin-config",
        text: "GitHub browser login is not configured in this build.",
      },
      card,
    );
  }
  oauth.addEventListener("click", () => {
    void (async () => {
      oauth.disabled = true;
      oauth.textContent = "Opening GitHub…";
      deviceState?.remove();
      deviceState = null;
      try {
        const session = await app.github.startDeviceLogin();
        if (!container.contains(card)) return;
        deviceState = createDiv("git-pr-device-state", card);
        card.insertBefore(deviceState, tokenToggle);
        deviceState.hidden = !tokenForm.hidden;
        createEl(
          "p",
          { text: "Copy this code, then authorize this app in your browser." },
          deviceState,
        );
        createDiv({ cls: "git-pr-device-code", text: session.userCode }, deviceState);
        const open = button(deviceState, "Copy code and open GitHub");
        open.addEventListener("click", () => {
          void navigator.clipboard?.writeText(session.userCode);
          openInSystemBrowser(session.verificationUri);
        });
        createEl("p", { text: "Waiting for authorization…" }, deviceState);
        oauth.textContent = "Waiting for GitHub…";
        const controller = new AbortController();
        oauthAbort = controller;
        const result = await app.github.completeDeviceLogin(session, controller.signal);
        if (!container.contains(card) || controller.signal.aborted) return;
        if ("error" in result) {
          showError(result.error);
          oauth.disabled = false;
          oauth.textContent = "Login with GitHub";
          return;
        }
        onAuth(result);
      } catch (error) {
        if (container.contains(card)) {
          showError(errorText(error));
          oauth.disabled = !app.github.hasDeviceLogin;
          oauth.textContent = "Login with GitHub";
        }
      }
    })();
  });

  const tokenToggle = button(card, "Login with personal GitHub token", "git-pr-signin-fallback");
  const tokenForm = createDiv("git-pr-token-form", card);
  tokenForm.hidden = true;
  tokenToggle.addEventListener("click", () => {
    tokenForm.hidden = !tokenForm.hidden;
    oauth.hidden = !tokenForm.hidden;
    if (configMessage) configMessage.hidden = !tokenForm.hidden;
    if (deviceState) deviceState.hidden = !tokenForm.hidden;
    card.querySelector(".git-pr-signin-error")?.remove();
    tokenToggle.textContent = tokenForm.hidden
      ? "Login with personal GitHub token"
      : "Use GitHub browser login";
  });
  const createToken = button(tokenForm, "Create a token on GitHub", "git-pr-signin-token-link");
  createToken.addEventListener("click", () => openInSystemBrowser(GITHUB_TOKEN_URL));
  const field = createEl("label", "git-pr-signin-field", tokenForm);
  createSpan({ text: "Personal access token" }, field);
  const input = createEl(
    "input",
    { attr: { type: "password", autocomplete: "off" }, placeholder: "ghp_… or github_pat_…" },
    field,
  );
  const submit = button(tokenForm, "Sign in", "mod-cta git-pr-signin-submit");
  submit.disabled = true;
  input.addEventListener("input", () => (submit.disabled = !input.value.trim()));
  const signIn = async (): Promise<void> => {
    submit.disabled = true;
    const result = await app.github.setToken(input.value);
    if ("error" in result) {
      showError(result.error);
      submit.disabled = false;
      return;
    }
    onAuth(result);
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && input.value.trim()) void signIn();
  });
  submit.addEventListener("click", () => void signIn());

  return {
    destroy(): void {
      oauthAbort?.abort();
      oauthAbort = null;
    },
  };
}

/** Renders the repository picker (owner/repo entry + your-repos list) into
 * `container`; calls `onPick` with the chosen repo. */
