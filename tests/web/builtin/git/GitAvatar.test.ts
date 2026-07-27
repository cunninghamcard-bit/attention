import { describe, expect, it } from "vitest";
import { githubAvatarUrl, renderGitAvatar } from "@web/builtin/git/GitAvatar";

function avatarFor(author: string, avatarUrl?: string): HTMLElement {
  return renderGitAvatar(document.createElement("div"), author, avatarUrl);
}

describe("renderGitAvatar", () => {
  it("colors the initial from a design token, and always the same one per author", () => {
    const first = avatarFor("Card");
    const second = avatarFor("Card");

    // A token reference, never a literal color: the chip has to follow
    // light/dark and community themes like the rest of the surface.
    expect(first.style.getPropertyValue("--git-avatar-background")).toMatch(
      /^var\(--color-[a-z]+\)$/,
    );
    expect(first.style.getPropertyValue("--git-avatar-color")).toBe("var(--text-on-accent)");
    expect(second.style.getPropertyValue("--git-avatar-background")).toBe(
      first.style.getPropertyValue("--git-avatar-background"),
    );
    expect(first.querySelector(".git-avatar-fallback")?.textContent).toBe("C");
  });

  it("spreads authors across the palette instead of painting one flat color", () => {
    const authors = ["Card", "Ada", "Linus", "Grace", "Alan", "Barbara", "Ken", "Dennis"];
    const colors = new Set(
      authors.map((author) => avatarFor(author).style.getPropertyValue("--git-avatar-background")),
    );

    expect(colors.size).toBeGreaterThan(1);
  });

  it("keeps the neutral default when there is no author to derive from", () => {
    const avatar = avatarFor("   ");

    expect(avatar.style.getPropertyValue("--git-avatar-background")).toBe("");
    expect(avatar.querySelector(".git-avatar-fallback")?.textContent).toBe("?");
  });

  it("shows the image when one is given, falling back to the initial on error", () => {
    const avatar = avatarFor("Card", "https://www.gravatar.com/avatar/abc?s=80&d=404");
    const image = avatar.querySelector(".git-avatar-image") as HTMLImageElement;

    expect(image).not.toBeNull();
    // d=404 means Gravatar 404s for an address with no photo, so this error path
    // is the normal case for most local commit authors — not an edge case.
    image.dispatchEvent(new Event("error"));

    expect(avatar.querySelector(".git-avatar-image")).toBeNull();
    expect(avatar.querySelector(".git-avatar-fallback")?.textContent).toBe("C");
  });
});

describe("githubAvatarUrl", () => {
  it("resolves the avatar from the email alone — no auth, no API call", () => {
    expect(githubAvatarUrl("card@example.com")).toBe(
      "https://avatars.githubusercontent.com/u/e?email=card%40example.com&s=80",
    );
  });

  it("trims and percent-encodes the address", () => {
    // A raw `+` in a query value decodes as a space, and GitHub's own noreply
    // addresses are full of them: `12345+login@users.noreply.github.com`.
    expect(githubAvatarUrl("  12345+card@users.noreply.github.com ")).toContain(
      "email=12345%2Bcard%40users.noreply.github.com",
    );
  });

  it("takes a size for denser displays", () => {
    expect(githubAvatarUrl("card@example.com", 160)).toContain("&s=160");
  });

  it("is not Gravatar", () => {
    // Gravatar only knows addresses that registered with Gravatar itself, which
    // most git identities never did — that is why every commit used to show an
    // initial even when GitHub had the photo.
    expect(githubAvatarUrl("card@example.com")).not.toContain("gravatar");
  });
});
