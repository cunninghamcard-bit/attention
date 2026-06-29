const ICON_PATHS: Record<string, string> = {
  "lucide-arrow-left": '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  "lucide-arrow-right": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  "lucide-arrow-up": '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  "lucide-arrow-up-right": '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  "lucide-arrow-down": '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  "lucide-archive": '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  "lucide-alert-triangle": '<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  "lucide-at-sign": '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
  "lucide-binary": '<rect x="14" y="14" width="4" height="6" rx="2"/><rect x="6" y="4" width="4" height="6" rx="2"/><path d="M6 20h4"/><path d="M14 10h4"/><path d="M6 14h2v6"/><path d="M14 4h2v6"/>',
  "lucide-book-open": '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  "lucide-calendar-days": '<path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>',
  "lucide-calendar": '<path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/>',
  "lucide-chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "lucide-chevron-left": '<path d="m15 18-6-6 6-6"/>',
  "lucide-chevron-right": '<path d="m9 18 6-6-6-6"/>',
  "lucide-chevrons-up-down": '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  "lucide-check": '<path d="M20 6 9 17l-5-5"/>',
  "lucide-check-square": '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m9 12 2 2 4-4"/>',
  "lucide-clock": '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  "lucide-code-2": '<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>',
  "lucide-copy": '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  "lucide-edit-3": '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  "lucide-eye": '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  "lucide-file": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  "lucide-file-code": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m10 13-2 2 2 2"/><path d="m14 17 2-2-2-2"/>',
  "lucide-file-question": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M10 13a2 2 0 1 1 3.3 1.5c-.8.5-1.3 1-1.3 2"/><path d="M12 19h.01"/>',
  "lucide-file-search": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h6"/><path d="M14 2v6h6"/><circle cx="15" cy="15" r="3"/><path d="m17.5 17.5 3 3"/>',
  "lucide-folder": '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>',
  "lucide-folder-cog": '<path d="M10 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v3"/><circle cx="16" cy="16" r="2"/><path d="M16 12v1"/><path d="M16 19v1"/><path d="m13.4 13.4.7.7"/><path d="m17.9 17.9.7.7"/><path d="M12 16h1"/><path d="M19 16h1"/><path d="m13.4 18.6.7-.7"/><path d="m17.9 14.1.7-.7"/>',
  "lucide-folder-tree": '<path d="M20 10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 2.1A2 2 0 0 0 7.9 1H4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2Z"/><path d="M4 10v4a2 2 0 0 0 2 2h5"/><path d="M11 16h5"/><path d="M16 16v5"/><path d="M20 21h-8a2 2 0 0 1-2-2v-1a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2Z"/>',
  "lucide-forward": '<polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/>',
  "lucide-git-fork": '<circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9"/><path d="M12 12v3"/>',
  "lucide-git-merge": '<path d="m8 6 4-4 4 4"/><path d="M12 2v10"/><path d="M18 22a4 4 0 0 0-4-4h-4a4 4 0 0 1-4-4V8"/><path d="M6 8l-4 4 4 4"/>',
  "lucide-globe": '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 0 20"/><path d="M12 2a15.3 15.3 0 0 0 0 20"/>',
  "lucide-history": '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  "lucide-help-circle": '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  "lucide-info": '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  "lucide-keyboard": '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01"/><path d="M10 10h.01"/><path d="M14 10h.01"/><path d="M18 10h.01"/><path d="M8 14h8"/><path d="M18 14h.01"/><path d="M6 14h.01"/>',
  "lucide-layers": '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.82l8.57 3.9a2 2 0 0 0 1.66 0l8.57-3.9a1 1 0 0 0 0-1.82z"/><path d="m22 12-9.17 4.18a2 2 0 0 1-1.66 0L2 12"/><path d="m22 17-9.17 4.18a2 2 0 0 1-1.66 0L2 17"/>',
  "lucide-layout-dashboard": '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  "lucide-link": '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  "lucide-list": '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  "lucide-list-plus": '<path d="M11 12H3"/><path d="M16 6H3"/><path d="M16 18H3"/><path d="M18 9v6"/><path d="M21 12h-6"/>',
  "lucide-list-tree": '<path d="M21 12h-8"/><path d="M21 6H8"/><path d="M21 18h-8"/><path d="M3 6v4c0 1.1.9 2 2 2h3"/><path d="M3 10v6c0 1.1.9 2 2 2h3"/>',
  "lucide-merge": '<path d="m8 6 4-4 4 4"/><path d="M12 2v10"/><path d="M18 22a4 4 0 0 0-4-4h-4a4 4 0 0 1-4-4V8"/><path d="M6 8l-4 4 4 4"/>',
  "lucide-menu": '<line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="18" x2="20" y2="18"/>',
  "lucide-unlink": '<path d="m18.84 12.25 1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="m5.17 11.75-1.73 1.71a5 5 0 0 0 7.07 7.07l1.72-1.71"/><path d="M8 12h8"/><path d="m2 2 20 20"/>',
  "links-coming-in": '<path d="M4 12h10"/><path d="m9 7 5 5-5 5"/><path d="M20 5v14"/>',
  "links-going-out": '<path d="M10 12h10"/><path d="m15 7 5 5-5 5"/><path d="M4 5v14"/>',
  "lucide-minus": '<path d="M5 12h14"/>',
  "lucide-more-horizontal": '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  "lucide-more-vertical": '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',
  "lucide-palette": '<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6 2 11.5S6.5 22 12 22h1.5a2.5 2.5 0 0 0 0-5H12a1.5 1.5 0 0 1 0-3h4.5A5.5 5.5 0 0 0 22 8.5C22 4.9 17.5 2 12 2z"/>',
  "lucide-pin": '<path d="M12 17v5"/><path d="M9 10.76V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3.76l2 2V15H7v-2.24z"/><path d="M8 3h8"/>',
  "lucide-pin-off": '<path d="M12 17v5"/><path d="m2 2 20 20"/><path d="M10.7 5A2 2 0 0 1 12 4h2a2 2 0 0 1 2 2v3.76l2 2V15h-2.24"/><path d="M8.24 15H7v-2.24l2-2V7"/>',
  "lucide-plus": '<path d="M5 12h14"/><path d="M12 5v14"/>',
  "lucide-puzzle": '<path d="M15.4 4.6a2.1 2.1 0 1 0-2.9-2.9L9.9 4.3H4a2 2 0 0 0-2 2v5.6l2.6-2.6a2.1 2.1 0 1 1 2.9 2.9L4.9 14.8V20a2 2 0 0 0 2 2h5.2l-2.6-2.6a2.1 2.1 0 1 1 2.9-2.9l2.6 2.6H20a2 2 0 0 0 2-2v-5.2l-2.6 2.6a2.1 2.1 0 1 1-2.9-2.9l2.6-2.6V4h-5.6z"/>',
  "lucide-picture-in-picture": '<path d="M8 4h10a2 2 0 0 1 2 2v10"/><path d="M2 10a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"/><path d="M10 13h3v3"/>',
  "lucide-picture-in-picture-2": '<path d="M8 4h10a2 2 0 0 1 2 2v10"/><path d="M2 10a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"/><path d="M10 13h3v3"/>',
  "lucide-refresh-cw": '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  "lucide-scan-eye": '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M2 12s3-5 10-5 10 5 10 5-3 5-10 5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  "lucide-scroll-text": '<path d="M8 21h12a2 2 0 0 0 2-2V5a3 3 0 0 0-3-3H8"/><path d="M8 21a3 3 0 0 1-3-3V5a3 3 0 1 0-3 3h3"/><path d="M10 8h8"/><path d="M10 12h8"/><path d="M10 16h5"/>',
  "lucide-separator-horizontal": '<line x1="3" y1="12" x2="21" y2="12"/><polyline points="8 8 12 4 16 8"/><polyline points="16 16 12 20 8 16"/>',
  "lucide-separator-vertical": '<line x1="12" y1="3" x2="12" y2="21"/><polyline points="8 8 4 12 8 16"/><polyline points="16 16 20 12 16 8"/>',
  "lucide-settings": '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.72l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  "lucide-square": '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  "lucide-star": '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  "lucide-terminal": '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  "lucide-terminal-square": '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m7 15 4-4-4-4"/><path d="M13 17h4"/>',
  "lucide-tags": '<path d="m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4l-4.6 4.6a2.4 2.4 0 0 1-3.4 0L7 13V5z"/><path d="M9.5 7.5h.01"/><path d="m4 8 6.3 6.3"/>',
  "lucide-text": '<path d="M17 6H3"/><path d="M21 12H3"/><path d="M15 18H3"/>',
  "lucide-toy-brick": '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M7 8V5a2 2 0 0 1 2-2h1v5"/><path d="M14 8V5a2 2 0 0 1 2-2h1v5"/><path d="M7 14h.01"/><path d="M12 14h.01"/><path d="M17 14h.01"/>',
  "lucide-trash-2": '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  "lucide-x": '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  "vault": '<path d="M4 4h16v16H4z"/><path d="M8 8h8"/><path d="M8 12h8"/><path d="M8 16h5"/>',
  "sheets-in-box": '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M7 7V3h10v4"/><path d="M8 12h8"/><path d="M8 16h8"/>',
  "sidebar-toggle-button-icon": '<rect x="1" y="2" width="22" height="20" rx="4"/><rect x="4" y="5" width="2" height="14" rx="2" fill="currentColor" class="sidebar-toggle-icon-inner"/>',
  "right-triangle": '<path d="M9 18 15 12 9 6z" fill="currentColor" stroke="none"/>',
};

export type IconName = string;

const BUILTIN_ICONS = new Map(Object.entries(ICON_PATHS));
const CUSTOM_ICONS = new Map<string, string>();

export function addIcon(iconId: string, svgContent: string): void {
  CUSTOM_ICONS.set(iconId, svgContent);
}

export function getIcon(iconId: string): SVGSVGElement | null {
  const normalizedIcon = normalizeIconName(iconId);
  const icon = getIconDefinition(normalizedIcon);
  return icon ? createSvgIcon(document, normalizedIcon, icon) : null;
}

export function getIconIds(): string[] {
  return [...new Set([...BUILTIN_ICONS.keys(), ...CUSTOM_ICONS.keys()])];
}

export function removeIcon(iconId: string): void {
  CUSTOM_ICONS.delete(iconId);
}

export function setIcon(parent: HTMLElement, icon: string): SVGSVGElement | null {
  const normalizedIcon = normalizeIconName(icon);
  const definition = getIconDefinition(normalizedIcon);
  const firstChild = parent.firstChild;
  if (firstChild instanceof SVGSVGElement && firstChild.classList.contains(icon)) return firstChild;
  firstChild?.remove();
  if (!definition) return null;

  const svg = createSvgIcon(parent.ownerDocument, normalizedIcon, definition);
  parent.appendChild(svg);
  return svg;
}

function normalizeIconName(icon: string): string {
  const normalizedIcon = normalizeIconId(icon);
  if (CUSTOM_ICONS.has(normalizedIcon) || BUILTIN_ICONS.has(normalizedIcon)) return normalizedIcon;
  const lucideIcon = `lucide-${normalizedIcon}`;
  return CUSTOM_ICONS.has(lucideIcon) || BUILTIN_ICONS.has(lucideIcon) ? lucideIcon : normalizedIcon;
}

function normalizeIconId(icon: string): string {
  return icon;
}

interface IconDefinition {
  content: string;
  custom: boolean;
}

function getIconDefinition(icon: string): IconDefinition | null {
  const custom = CUSTOM_ICONS.get(icon);
  if (custom != null) return { content: custom, custom: true };
  const builtin = BUILTIN_ICONS.get(icon);
  return builtin == null ? null : { content: builtin, custom: false };
}

function createSvgIcon(doc: Document, icon: string, definition: IconDefinition): SVGSVGElement {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("svg-icon", icon);
  svg.setAttribute("viewBox", definition.custom ? "0 0 100 100" : "0 0 24 24");
  if (!definition.custom) {
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
  }
  svg.innerHTML = definition.content;
  return svg;
}
