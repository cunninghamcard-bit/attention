/**
 * Input: None
 * Output: renderGitAvatar
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * A commit author's avatar, from their email alone.
 *
 * GitHub resolves an email to that account's avatar with no auth and no API
 * call — the endpoint GitLens and friends use. Measured: a linked address
 * returns the real photo (`image/jpeg`), an unlinked one returns GitHub's own
 * identicon (`image/png`). There is no 404 mode (`d=404` and `default=404` both
 * still return the identicon), so the initial-letter fallback below now only
 * covers load failures, not "no avatar".
 *
 * Gravatar was the previous source and it was the wrong one: it only knows
 * addresses that registered with Gravatar itself, which most git identities
 * never did, so every commit fell through to an initial.
 *
 * Note this sends the author's email to GitHub in the clear (Gravatar took an
 * MD5). For a repo already hosted there it tells GitHub nothing new; for a
 * private local repo it does.
 */
export function githubAvatarUrl(email: string, size = 80): string {
  const address = email.trim();
  return `https://avatars.githubusercontent.com/u/e?email=${encodeURIComponent(address)}&s=${size}`;
}

/**
 * The token layer's semantic colors, picked deterministically per author. No new
 * palette — these are the same tokens callouts and the git status marks consume,
 * so the initial avatars follow light/dark and any community theme, and the same
 * author always gets the same color.
 */
const AVATAR_COLOR_TOKENS = [
  "--color-red",
  "--color-orange",
  "--color-yellow",
  "--color-green",
  "--color-cyan",
  "--color-blue",
  "--color-purple",
  "--color-pink",
] as const;

function avatarColorToken(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return AVATAR_COLOR_TOKENS[Math.abs(hash) % AVATAR_COLOR_TOKENS.length];
}

/** Renders a local Git author avatar with the same initial fallback as Codiff. */
export function renderGitAvatar(
  parentEl: HTMLElement,
  author: string,
  avatarUrl?: string,
  /** Append the author's name after the chip. Off when the caller lays the name
   * out itself — a header where the chip spans two lines of identity. */
  withName = true,
): HTMLElement {
  const doc = parentEl.ownerDocument;
  const trimmed = author.trim();
  const avatarEl = doc.createElement("span");
  avatarEl.className = "git-avatar";
  avatarEl.setAttribute("aria-hidden", "true");
  if (trimmed) {
    avatarEl.style.setProperty("--git-avatar-background", `var(${avatarColorToken(trimmed)})`);
    avatarEl.style.setProperty("--git-avatar-color", "var(--text-on-accent)");
  }

  const fallbackEl = doc.createElement("span");
  fallbackEl.className = "git-avatar-fallback";
  fallbackEl.textContent = trimmed.charAt(0).toUpperCase() || "?";

  if (avatarUrl) {
    const imageEl = doc.createElement("img");
    imageEl.className = "git-avatar-image";
    imageEl.src = avatarUrl;
    imageEl.alt = "";
    imageEl.draggable = false;
    imageEl.addEventListener("error", () => imageEl.replaceWith(fallbackEl), { once: true });
    avatarEl.appendChild(imageEl);
  } else avatarEl.appendChild(fallbackEl);

  parentEl.appendChild(avatarEl);
  if (withName) parentEl.append(author);
  return avatarEl;
}
