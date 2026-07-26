import { afterEach, describe, expect, it, vi } from "vitest";
import { installExternalLinkHandler, type OpenUrlDetail } from "@web/app/ExternalLinks";

function clickLink(href: string, init: MouseEventInit = {}): HTMLAnchorElement {
  const linkEl = document.createElement("a");
  linkEl.href = href;
  linkEl.target = "_blank";
  linkEl.textContent = href;
  document.body.appendChild(linkEl);
  linkEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
  return linkEl;
}

describe("external links", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
    document.body.replaceChildren();
  });

  function install(): void {
    cleanups.push(installExternalLinkHandler(document));
  }

  it("hands an unclaimed external link to the OS browser instead of a child window", () => {
    const open = vi.fn();
    Object.defineProperty(window, "open", { configurable: true, value: open });
    install();

    clickLink("https://obsidian.md/");

    expect(open).toHaveBeenCalledWith("https://obsidian.md/", "_blank");
  });

  it("lets a listener claim the URL — the Web viewer's in-app path", () => {
    const open = vi.fn();
    Object.defineProperty(window, "open", { configurable: true, value: open });
    const claimed: OpenUrlDetail[] = [];
    const listener = (event: Event): void => {
      claimed.push((event as CustomEvent<OpenUrlDetail>).detail);
      event.preventDefault();
    };
    window.addEventListener("open-url", listener);
    cleanups.push(() => window.removeEventListener("open-url", listener));
    install();

    clickLink("https://obsidian.md/");

    expect(claimed).toEqual([{ url: "https://obsidian.md/", leaf: "tab", active: true }]);
    expect(open).not.toHaveBeenCalled();
  });

  it("asks for a split on a modifier click and ignores internal links", () => {
    const open = vi.fn();
    Object.defineProperty(window, "open", { configurable: true, value: open });
    const leaves: string[] = [];
    const listener = (event: Event): void => {
      leaves.push((event as CustomEvent<OpenUrlDetail>).detail.leaf);
      event.preventDefault();
    };
    window.addEventListener("open-url", listener);
    cleanups.push(() => window.removeEventListener("open-url", listener));
    install();

    clickLink("https://obsidian.md/", { metaKey: true });
    clickLink("#heading");

    expect(leaves).toEqual(["split"]);
    expect(open).not.toHaveBeenCalled();
  });
});
