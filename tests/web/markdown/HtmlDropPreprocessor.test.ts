import { describe, expect, it } from "vitest";
import { preprocessHtmlDrop } from "@web/markdown/HtmlDropPreprocessor";

describe("preprocessHtmlDrop", () => {
  it("removes ignored tags and unsafe attributes while applying the anchor hook", () => {
    const result = preprocessHtmlDrop(`
      <style>.x{}</style>
      <script>alert(1)</script>
      <p onclick="alert(1)">Hello <a href="https://example.com" onclick="bad()">link</a></p>
      <a href="https://example.org" rel="author">keeps rel</a>
    `);

    expect(result.detachedImages).toEqual([]);
    expect(result.html).not.toContain("script");
    expect(result.html).not.toContain("style");
    expect(result.html).not.toContain("onclick");
    expect(result.html).toContain('target="_blank"');
    expect(result.html).toContain('rel="noopener nofollow"');
    expect(result.html).toContain('rel="author"');
  });

  it("detaches long png and jpeg data urls from image nodes", () => {
    const png = makeDataUrl("image/png", 800, 7);
    const jpeg = makeDataUrl("image/jpeg", 800, 9);
    const short = "data:image/png;base64,AQID";

    const result = preprocessHtmlDrop(
      `<p>Before</p><img src="${png}"><img src="${jpeg}"><img src="${short}"><p>After</p>`,
    );

    expect(result.detachedImages).toHaveLength(2);
    expect(result.detachedImages.map((image) => image.extension)).toEqual(["png", "jpg"]);
    expect([...new Uint8Array(result.detachedImages[0]!.data).slice(0, 3)]).toEqual([7, 7, 7]);
    expect([...new Uint8Array(result.detachedImages[1]!.data).slice(0, 3)]).toEqual([9, 9, 9]);
    expect(result.html).toContain("<p>Before</p>");
    expect(result.html).toContain(short);
    expect(result.html).toContain("<p>After</p>");
    expect(result.html).not.toContain(png);
    expect(result.html).not.toContain(jpeg);
  });

  it("rewrites resource-prefixed media src through the supplied linktext resolver", () => {
    const result = preprocessHtmlDrop(
      `
      <p><img src="app://resource/Users/me/Vault/image.png?123" alt="Image"></p>
      <video><source src="app://resource/Users/me/Vault/movie.mp4"></video>
      <iframe src="app://resource/Users/me/Vault/embed.html"></iframe>
    `,
      {
        resourcePathPrefix: "app://resource/",
        resolveMediaLinktext: (fileUrl) =>
          ({
            "file:///Users/me/Vault/image.png?123": "image.png",
            "file:///Users/me/Vault/movie.mp4": "movie.mp4",
            "file:///Users/me/Vault/embed.html": "embed.html",
          })[fileUrl] ?? null,
      },
    );

    expect(result.html).toContain('<img src="image.png" alt="Image">');
    expect(result.html).toContain('<source src="movie.mp4">');
    expect(result.html).toContain(
      '<iframe src="embed.html" sandbox="allow-forms allow-presentation allow-same-origin allow-scripts allow-modals"></iframe>',
    );
  });

  it("sanitizes iframe sandbox and allow tokens like the original hook", () => {
    const result = preprocessHtmlDrop(`
      <iframe
        src="https://example.com"
        sandbox="allow-scripts allow-popups allow-same-origin"
        allow="fullscreen; bad-feature; camera https://example.com"
        data-bad="x"
        data-tooltip-position="top"
      ></iframe>
    `);

    expect(result.html).toContain('sandbox="allow-scripts allow-same-origin"');
    expect(result.html).toContain('allow="fullscreen; camera https://example.com"');
    expect(result.html).toContain('data-tooltip-position="top"');
    expect(result.html).not.toContain("allow-popups");
    expect(result.html).not.toContain("bad-feature");
    expect(result.html).not.toContain("data-bad");
  });

  it("keeps unsupported long data media instead of deleting non-detached payloads", () => {
    const audio = `data:audio/ogg;base64,${"A".repeat(1200)}`;
    const gif = `data:image/gif;base64,${"B".repeat(1200)}`;

    const result = preprocessHtmlDrop(`<audio src="${audio}"></audio><img src="${gif}">`);

    expect(result.detachedImages).toEqual([]);
    expect(result.html).toContain(audio);
    expect(result.html).toContain(gif);
  });
});

function makeDataUrl(mime: string, length: number, byte: number): string {
  const bytes = new Uint8Array(length).fill(byte);
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return `data:${mime};base64,${btoa(binary)}`;
}
