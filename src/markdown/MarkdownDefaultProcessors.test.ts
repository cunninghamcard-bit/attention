import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../app/App";
import { Component } from "../core/Component";
import { MarkdownRenderer } from "./MarkdownRenderer";

describe("Markdown default processors", () => {
  beforeEach(() => {
    Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
    delete (globalThis as { mermaid?: unknown }).mermaid;
  });

  it("renders math and mermaid code blocks through the public helper pipeline", async () => {
    const app = new App(document.createElement("div"));
    const owner = new Component();
    const container = document.createElement("div");

    await MarkdownRenderer.render(app, "```math\nx^2\n```\n\n```mermaid\ngraph TD; A-->B;\n```", container, "Note.md", owner);

    expect(container.querySelector(".block-language-math .math.math-block")?.textContent).toBe("x^2");
    const mermaid = container.querySelector<HTMLElement>(".block-language-mermaid.mermaid");
    expect(mermaid?.querySelector("svg")?.getAttribute("data-mermaid-source")).toBe("graph TD; A-->B;");
    expect(container.textContent).not.toContain("placeholder");
  });

  // Media embeds — verbatim ports of the real embed components (tJ/nJ/iJ,
  // xc/Dc/Ac helpers, applyTitle/zx alias parsing).
  describe("media embeds", () => {
    async function render(markdown: string): Promise<{ app: App; container: HTMLElement }> {
      const app = new App(document.createElement("div"));
      await app.vault.create("Pics/gradient.png", "fake-png-bytes");
      await app.vault.create("Clip.mp3", "fake-audio");
      await app.vault.create("Movie.mp4", "fake-video");
      await app.vault.create("Paper.pdf", "fake-pdf");
      await app.vault.create("Data.zip", "fake-zip");
      await app.vault.create("Other.md", "# other");
      const container = document.createElement("div");
      await MarkdownRenderer.render(app, markdown, container, "Note.md", new Component());
      return { app, container };
    }

    it("renders a wiki image embed as .image-embed with an img", async () => {
      const { container } = await render("![[Pics/gradient.png]]");
      const embed = container.querySelector<HTMLElement>(".internal-embed.image-embed.is-loaded");
      expect(embed?.getAttribute("src")).toBe("Pics/gradient.png");
      const img = embed?.querySelector("img");
      expect(img).toBeTruthy();
      // The adapter's resource path (memory:// here, app://…/file on desktop).
      expect(img?.getAttribute("src")).toBe("memory://Pics%2Fgradient.png");
      // No alias → no alt (real xc: alt comes only from the container attr).
      expect(img?.hasAttribute("alt")).toBe(false);
    });

    it("parses the alias as dimensions (|64, |64x48) or alt text, last segment wins", async () => {
      const { container } = await render(
        "![[Pics/gradient.png|64]]\n\n![[Pics/gradient.png|64x48]]\n\n![[Pics/gradient.png|a caption|64x48]]\n\n![[Pics/gradient.png|just alt]]",
      );
      const images = [...container.querySelectorAll(".image-embed img")];
      expect(images[0]?.getAttribute("width")).toBe("64");
      expect(images[0]?.hasAttribute("height")).toBe(false);
      expect(images[1]?.getAttribute("width")).toBe("64");
      expect(images[1]?.getAttribute("height")).toBe("48");
      expect(images[2]?.getAttribute("alt")).toBe("a caption");
      expect(images[2]?.getAttribute("width")).toBe("64");
      expect(images[3]?.getAttribute("alt")).toBe("just alt");
      expect(images[3]?.hasAttribute("width")).toBe(false);
    });

    it("renders audio/video/pdf/generic embeds with the real classes and elements", async () => {
      const { container } = await render("![[Clip.mp3]]\n\n![[Movie.mp4]]\n\n![[Paper.pdf]]\n\n![[Data.zip]]");
      const audio = container.querySelector<HTMLElement>(".internal-embed.audio-embed audio");
      expect(audio?.getAttribute("controls")).toBe("");
      expect(audio?.getAttribute("controlsList")).toBe("nodownload");
      const video = container.querySelector<HTMLElement>(".internal-embed.video-embed video");
      expect(video?.getAttribute("preload")).toBe("metadata");
      expect(container.querySelector(".internal-embed.pdf-embed iframe")).toBeTruthy();
      const generic = container.querySelector<HTMLElement>(".internal-embed.file-embed.mod-generic");
      expect(generic?.querySelector(".file-embed-title")?.textContent).toBe("Data.zip");
    });

    it("keeps the note-embed placeholder and the missing-embed text", async () => {
      const { container } = await render("![[Other]]\n\n![[nope.png]]");
      expect(container.textContent).toContain("Embedded: Other.md");
      expect(container.textContent).toContain("Missing embed: nope.png");
    });

    it("routes markdown-image syntax through the same embed pipeline", async () => {
      const { container } = await render("![300](Pics/gradient.png)\n\n![ext](https://host/x.png)");
      const img = container.querySelector(".internal-embed.image-embed img");
      expect(img?.getAttribute("width")).toBe("300");
      const external = container.querySelector('img[src="https://host/x.png"]');
      expect(external?.getAttribute("alt")).toBe("ext");
    });
  });
});
