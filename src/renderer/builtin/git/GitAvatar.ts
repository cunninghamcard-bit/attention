/** Renders a local Git author avatar with the same initial fallback as Codiff. */
export function renderGitAvatar(
  parentEl: HTMLElement,
  author: string,
  avatarUrl?: string,
): HTMLElement {
  const doc = parentEl.ownerDocument;
  const avatarEl = doc.createElement("span");
  avatarEl.className = "git-avatar";
  avatarEl.setAttribute("aria-hidden", "true");

  const fallbackEl = doc.createElement("span");
  fallbackEl.className = "git-avatar-fallback";
  fallbackEl.textContent = author.trim().charAt(0).toUpperCase() || "?";

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
  parentEl.append(author);
  return avatarEl;
}
