import type { PropertyWidgetContext } from "./PropertyTypes";

export interface PropertyLinkRenderOptions {
  onEdit?(): void;
}

interface ParsedPropertyLink {
  internal: boolean;
  external: boolean;
  href: string;
  label: string;
}

export function renderPropertyLinkValue(
  value: string,
  parent: HTMLElement,
  context: PropertyWidgetContext,
  options: PropertyLinkRenderOptions = {},
): boolean {
  const parsed = parsePropertyLink(value);
  if (!parsed || !context.app) return false;

  const wrapperEl = document.createElement("span");
  wrapperEl.className = "metadata-link";
  const linkEl = document.createElement("span");
  linkEl.className = "metadata-link-inner";
  linkEl.textContent = parsed.label;
  linkEl.dataset.href = parsed.href;
  linkEl.classList.toggle("internal-link", parsed.internal);
  linkEl.classList.toggle("external-link", parsed.external);
  if (parsed.internal) {
    const unresolved = !context.app.metadataCache.getFirstLinkpathDest(
      parsed.href,
      context.sourcePath ?? "",
    );
    linkEl.classList.toggle("is-unresolved", unresolved);
  }

  linkEl.addEventListener("click", (event) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    if (parsed.internal)
      void context.app?.workspace.openLinkText(parsed.href, context.sourcePath ?? "", undefined, {
        active: !isModEvent(event),
      });
    else window.open(parsed.href, "_blank");
  });
  linkEl.addEventListener("open-link", (event) => {
    event.preventDefault();
    if (parsed.internal)
      void context.app?.workspace.openLinkText(parsed.href, context.sourcePath ?? "", undefined, {
        active: true,
      });
    else window.open(parsed.href, "_blank");
  });
  if (parsed.internal) {
    linkEl.addEventListener("mouseover", (event) => {
      context.app?.workspace.trigger("hover-link", {
        event,
        source: "metadata-property",
        hoverParent: null,
        targetEl: linkEl,
        linktext: parsed.href,
        sourcePath: context.sourcePath ?? "",
      });
    });
  }

  wrapperEl.appendChild(linkEl);
  if (options.onEdit) {
    const editEl = document.createElement("span");
    editEl.className = "metadata-link-flair clickable-icon";
    editEl.dataset.icon = "lucide-pencil";
    editEl.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      options.onEdit?.();
    });
    wrapperEl.addEventListener("click", (event) => {
      if (event.target === wrapperEl) options.onEdit?.();
    });
    wrapperEl.appendChild(editEl);
  }

  parent.replaceChildren(wrapperEl);
  return true;
}

export function parsePropertyLink(value: string): ParsedPropertyLink | null {
  const text = value.trim();
  if (text.startsWith("[[") && text.endsWith("]]")) {
    const inner = text.slice(2, -2);
    const pipeIndex = inner.indexOf("|");
    const href = pipeIndex === -1 ? inner : inner.slice(0, pipeIndex);
    const label = pipeIndex === -1 ? href : inner.slice(pipeIndex + 1);
    if (!href) return null;
    return { internal: true, external: false, href, label: label || href };
  }

  const markdown = /^\[([^\]]*)\]\((<?)([^)>]+)(>?)\)$/.exec(text);
  if (markdown) {
    const label = markdown[1];
    const href = markdown[3].trim();
    const internal = isInternalHref(href);
    return {
      internal,
      external: !internal,
      href: internal ? safeDecode(href) : href,
      label: label || href,
    };
  }

  if (isExternalUrl(text)) return { internal: false, external: true, href: text, label: text };
  if (isEmailAddress(text))
    return { internal: false, external: true, href: `mailto:${text}`, label: text };
  return null;
}

function isInternalHref(href: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("#");
}

function isExternalUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function isEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function safeDecode(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function isModEvent(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey;
}
