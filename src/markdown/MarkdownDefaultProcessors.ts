import type { App } from "../app/App";
import type { TFile } from "../vault/TAbstractFile";
import { finishRenderMath, loadMermaid, renderMath } from "../api/ApiUtils";
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, PDF_EXTENSIONS, VIDEO_EXTENSIONS, mimeForExtension } from "../views/MediaViews";
import { MarkdownRenderer, type MarkdownCodeBlockProcessor, type MarkdownPostProcessorContext } from "./MarkdownRenderer";

export function registerMarkdownDefaultProcessors(app: App): void {
  registerCodeBlockPostProcessor("mermaid", async (source, el) => {
    el.classList.add("block-language-mermaid", "mermaid");
    el.replaceChildren();
    try {
      const mermaid = await loadMermaid();
      const rendered = await mermaid.render(`mermaid-${hashSource(source)}`, source);
      const svg = typeof rendered === "string" ? rendered : rendered?.svg;
      if (typeof svg === "string" && svg.trim()) el.innerHTML = svg;
      else el.textContent = source;
    } catch (error) {
      el.classList.add("mod-error");
      el.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  registerCodeBlockPostProcessor("math", async (source, el) => {
    el.classList.add("block-language-math");
    el.replaceChildren(renderMath(source, true));
    await finishRenderMath();
  });

  registerCodeBlockPostProcessor("query", async (source, el) => {
    el.classList.add("block-language-query");
    el.textContent = `Search/query block placeholder:\n${source}`;
  });

  // The embed loader — real embed registry semantics: per-extension embed
  // components (image-embed/audio-embed/video-embed/pdf-embed/file-embed)
  // whose element builders are ports of the real `xc`/`Dc`/`Ac` helpers. Only
  // the markdown NOTE embed (the recursive renderer) stays a placeholder.
  MarkdownRenderer.registerPostProcessor(async (root, context) => {
    for (const embed of root.querySelectorAll<HTMLElement>(".internal-embed")) {
      const target = embed.dataset.href;
      if (!target) continue;
      const file = app.metadataCache.getFirstLinkpathDest(target, context.sourcePath);
      embed.classList.toggle("is-loaded", Boolean(file));
      if (!file) {
        embed.textContent = `Missing embed: ${target}`;
        continue;
      }
      if (IMAGE_EXTENSIONS.includes(file.extension)) {
        embed.classList.add("image-embed");
        embed.replaceChildren();
        renderImageInto(embed, await mediaSrc(app, file, mimeForExtension(file.extension, "image/*")));
      } else if (AUDIO_EXTENSIONS.includes(file.extension)) {
        embed.classList.add("audio-embed");
        embed.replaceChildren();
        renderAudioInto(embed, await mediaSrc(app, file, mimeForExtension(file.extension, "audio/*")));
      } else if (VIDEO_EXTENSIONS.includes(file.extension)) {
        embed.classList.add("video-embed");
        embed.replaceChildren();
        renderVideoInto(embed, await mediaSrc(app, file, mimeForExtension(file.extension, "video/*")));
      } else if (PDF_EXTENSIONS.includes(file.extension)) {
        // Real pdf embed: an iframe filling the container.
        embed.classList.add("pdf-embed");
        embed.replaceChildren();
        const frame = document.createElement("iframe");
        frame.style.width = "100%";
        frame.style.height = "100%";
        embed.appendChild(frame);
        frame.src = await mediaSrc(app, file, "application/pdf");
      } else if (file.extension === "md") {
        // Note embeds still render as a placeholder — the recursive note
        // renderer is its own feature.
        embed.textContent = `Embedded: ${file.path}`;
      } else {
        // Real generic embed (`rJ`): a titled chip for any other extension.
        embed.classList.add("file-embed", "mod-generic");
        embed.replaceChildren();
        const titleEl = document.createElement("div");
        titleEl.className = "file-embed-title";
        titleEl.textContent = file.name;
        embed.appendChild(titleEl);
      }
    }
  }, -10);

  MarkdownRenderer.registerPostProcessor((root) => {
    for (const paragraph of root.querySelectorAll("p")) {
      const text = paragraph.textContent ?? "";
      const callout = text.match(/^\[!(\w+)\]\s*(.*)$/);
      if (!callout) continue;
      paragraph.classList.add("callout", `callout-${callout[1].toLowerCase()}`);
      paragraph.textContent = callout[2] || callout[1];
    }
  });

  MarkdownRenderer.registerPostProcessor((root, context) => {
    app.fixFileLinks(root, context.sourcePath);
  });

  MarkdownRenderer.registerPostProcessor(addCopyCodeButtons);

  app.workspace.trigger("post-processor-change");
}

// Obsidian shows a copy button on every rendered code fence; app.css already
// ships the .copy-code-button styles. Registered as a default post-processor
// so both MarkdownView and ChatView get it.
export function addCopyCodeButtons(root: HTMLElement): void {
  // Post-processors receive each section element directly, so the root may
  // itself be the pre of a code fence.
  const pres = root instanceof HTMLPreElement ? [root] : [...root.querySelectorAll("pre")];
  for (const pre of pres) {
    const code = pre.querySelector("code");
    if (!code || pre.querySelector(".copy-code-button")) continue;
    const button = pre.ownerDocument.createElement("button");
    button.className = "copy-code-button";
    button.textContent = "Copy";
    button.addEventListener("click", () => {
      void navigator.clipboard?.writeText(code.textContent ?? "").then(() => {
        button.textContent = "Copied!";
        window.setTimeout(() => {
          button.textContent = "Copy";
        }, 1500);
      });
    });
    pre.appendChild(button);
  }
}

function registerCodeBlockPostProcessor(language: string, processor: MarkdownCodeBlockProcessor): void {
  const wrapper = MarkdownRenderer.createCodeBlockPostProcessor(language, processor);
  MarkdownRenderer.registerPostProcessor(wrapper);
  MarkdownRenderer.registerCodeBlockPostProcessor(language, processor);
}

// The container's resource URL: the adapter's resource path when it has one
// (desktop), else the file bytes as an object/data URL (in-memory vaults).
async function mediaSrc(app: App, file: TFile, mime: string): Promise<string> {
  const resourcePath = app.vault.getResourcePath(file);
  if (resourcePath) return resourcePath;
  const data = await app.vault.readBinary(file);
  if (typeof URL.createObjectURL === "function") return URL.createObjectURL(new Blob([data], { type: mime }));
  let binary = "";
  for (const byte of new Uint8Array(data)) binary += String.fromCharCode(byte);
  return `data:${mime};base64,${btoa(binary)}`;
}

// Real `xc`: the img inherits the container's alt/width/height attributes;
// listeners go on before src is set. (The real helper also awaits
// load/error/5s for reader-view layout stability — not reconstructed.)
function renderImageInto(container: HTMLElement, url: string): void {
  const img = document.createElement("img");
  const alt = container.getAttribute("alt");
  if (alt) img.setAttribute("alt", alt);
  const width = container.getAttribute("width");
  if (width) img.setAttribute("width", width);
  const height = container.getAttribute("height");
  if (height) img.setAttribute("height", height);
  container.appendChild(img);
  img.src = url;
}

// Real `Dc`.
function renderAudioInto(container: HTMLElement, url: string): HTMLAudioElement {
  const audio = document.createElement("audio");
  audio.setAttribute("controls", "");
  audio.setAttribute("controlsList", "nodownload");
  container.appendChild(audio);
  audio.src = url;
  return audio;
}

// Real `Ac`: a video whose metadata reports 0x0 (an audio file in a video
// container) is torn down and replaced with the audio element.
function renderVideoInto(container: HTMLElement, url: string): void {
  const video = document.createElement("video");
  video.setAttribute("controls", "");
  video.setAttribute("preload", "metadata");
  video.addEventListener("loadedmetadata", () => {
    if (video.videoWidth === 0 && video.videoHeight === 0) {
      video.src = "";
      video.remove();
      renderAudioInto(container, url);
    }
  });
  container.appendChild(video);
  video.src = url;
}

function hashSource(source: string): string {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
