export interface DetachedHtmlImage {
  data: ArrayBuffer;
  extension: "jpg" | "png";
}

export interface PreprocessedHtmlDrop {
  detachedImages: DetachedHtmlImage[];
  html: string;
}

export interface HtmlDropPreprocessOptions {
  resourcePathPrefix?: string;
  resolveMediaLinktext?: (fileUrl: string) => string | null;
}

const LONG_DATA_URL_LENGTH = 1000;
const DATA_IMAGE_REGEX = /^data:([\w/.-]+);base64,(.*)$/;
const ALLOWED_IFRAME_ATTRS = new Set(["allow", "allowfullscreen", "frameborder", "sandbox"]);
const DEFAULT_IFRAME_SANDBOX =
  "allow-forms allow-presentation allow-same-origin allow-scripts allow-modals";
const ALLOWED_IFRAME_SANDBOX_TOKENS = new Set(DEFAULT_IFRAME_SANDBOX.split(" "));
const ALLOWED_IFRAME_ALLOW_TOKENS = new Set([
  "accelerometer",
  "ambient-light-sensor",
  "autoplay",
  "battery",
  "camera",
  "clipboard-read",
  "clipboard-write",
  "display-capture",
  "document-domain",
  "encrypted-media",
  "fullscreen",
  "gamepad",
  "geolocation",
  "gyroscope",
  "layout-animations",
  "legacy-image-formats",
  "magnetometer",
  "microphone",
  "midi",
  "oversized-images",
  "payment",
  "picture-in-picture",
  "publickey-credentials-get",
  "speaker-selection",
  "sync-xhr",
  "unoptimized-images",
  "unsized-media",
  "usb",
  "screen-wake-lock",
  "web-share",
  "xr-spatial-tracking",
]);

export function preprocessHtmlDrop(
  html: string,
  options: HtmlDropPreprocessOptions = {},
): PreprocessedHtmlDrop {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  const fragment = document.importNode(template.content, true);
  sanitizeFragment(fragment);

  const container = document.createElement("div");
  container.appendChild(fragment);
  const detachedImages: DetachedHtmlImage[] = [];

  for (const media of container.querySelectorAll("img, audio, video, source, iframe")) {
    if (!(media instanceof HTMLElement)) continue;
    let src = media.getAttribute("src") ?? "";
    if (options.resourcePathPrefix && src.startsWith(options.resourcePathPrefix)) {
      const fileUrl = `file:///${src.slice(options.resourcePathPrefix.length)}`;
      media.setAttribute("src", options.resolveMediaLinktext?.(fileUrl) ?? fileUrl);
      src = media.getAttribute("src") ?? "";
    }
    if (!src.startsWith("data:") || src.length <= LONG_DATA_URL_LENGTH) continue;
    if (!(media instanceof HTMLImageElement)) continue;
    const image = decodeDetachedImage(src);
    if (!image) continue;
    detachedImages.push(image);
    media.remove();
  }

  return {
    detachedImages,
    html: container.innerHTML.trim(),
  };
}

function sanitizeFragment(fragment: DocumentFragment): void {
  for (const node of fragment.querySelectorAll("script, style, title")) node.remove();
  for (const element of fragment.querySelectorAll<HTMLElement>("*")) sanitizeElement(element);
}

function sanitizeElement(element: HTMLElement): void {
  for (const attr of Array.from(element.attributes)) {
    const name = attr.name.toLowerCase();
    const value = attr.value.trim().toLowerCase();
    if (name.startsWith("on")) element.removeAttribute(attr.name);
    else if (name === "style") element.removeAttribute(attr.name);
    else if ((name === "src" || name === "href") && value.startsWith("javascript:"))
      element.removeAttribute(attr.name);
    else if (
      element instanceof HTMLIFrameElement &&
      name.startsWith("data-") &&
      name !== "data-tooltip-position"
    )
      element.removeAttribute(attr.name);
    else if (
      element instanceof HTMLIFrameElement ||
      (name !== "sandbox" &&
        name !== "allowfullscreen" &&
        name !== "frameborder" &&
        name !== "allow")
    )
      continue;
    else if (!ALLOWED_IFRAME_ATTRS.has(name)) element.removeAttribute(attr.name);
  }

  if (element instanceof HTMLAnchorElement) {
    element.setAttribute("target", "_blank");
    if (!element.hasAttribute("rel")) element.setAttribute("rel", "noopener nofollow");
  }

  if (element instanceof HTMLIFrameElement) {
    if (element.hasAttribute("sandbox")) {
      sanitizeTokenListAttribute(element, "sandbox", " ", ALLOWED_IFRAME_SANDBOX_TOKENS);
    } else {
      element.setAttribute("sandbox", DEFAULT_IFRAME_SANDBOX);
    }
    if (element.hasAttribute("allow"))
      sanitizeTokenListAttribute(element, "allow", ";", ALLOWED_IFRAME_ALLOW_TOKENS);
  }
}

function decodeDetachedImage(dataUrl: string): DetachedHtmlImage | null {
  const match = DATA_IMAGE_REGEX.exec(dataUrl);
  if (!match) return null;
  const mime = match[1];
  const extension = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : null;
  if (!extension) return null;
  return {
    data: decodeBase64(match[2]),
    extension,
  };
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function sanitizeTokenListAttribute(
  element: HTMLElement,
  attr: string,
  separator: string,
  allowed: Set<string>,
): void {
  const raw = element.getAttribute(attr) ?? "";
  const values = raw
    .split(separator)
    .map((token) => token.trim())
    .filter((token) => token && allowed.has(token.split(/\s+/, 1)[0]!.toLowerCase()));

  if (values.length > 0) element.setAttribute(attr, values.join(separator === ";" ? "; " : " "));
  else element.removeAttribute(attr);
}
