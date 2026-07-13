import { createFileTreeIconResolver, getBuiltInSpriteSheet } from "@pierre/trees";

export interface FileTypeInfo {
  icon: string;
  /** Pierre's semantic icon token, used for presentation and tests. */
  lang: string;
}

const SPRITE_ID = "attention-file-icon-sprite";
const { resolveIcon } = createFileTreeIconResolver("complete");

export function getFileTypeInfo(name: string, extension = ""): FileTypeInfo {
  const path = name.includes(".") || !extension ? name : `${name}.${extension}`;
  const resolved = resolveIcon("file-tree-icon-file", path);
  return { icon: resolved.name, lang: resolved.token ?? "default" };
}

export function createFileTypeIcon(
  doc: Document,
  icon: string,
  token = icon.replace(/^file-tree-builtin-/, ""),
): SVGSVGElement | null {
  if (!icon.startsWith("file-tree-builtin-")) return null;
  ensureSprite(doc);
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("svg-icon", "file-type-icon", icon);
  svg.dataset.iconToken = token;
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  const use = doc.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${icon}`);
  svg.append(use);
  return svg;
}

export function setFileTypeIcon(parent: HTMLElement, path: string): SVGSVGElement {
  const { icon, lang } = getFileTypeInfo(path);
  parent.replaceChildren(createFileTypeIcon(parent.ownerDocument, icon, lang)!);
  parent.dataset.iconToken = lang;
  return parent.firstElementChild as SVGSVGElement;
}

function ensureSprite(doc: Document): void {
  if (doc.getElementById(SPRITE_ID)) return;
  const host = doc.createElement("div");
  host.id = SPRITE_ID;
  host.hidden = true;
  host.setAttribute("aria-hidden", "true");
  host.innerHTML = getBuiltInSpriteSheet("complete");
  (doc.body ?? doc.documentElement).prepend(host);
}
