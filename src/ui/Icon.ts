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
  "lucide-edit": '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  "lucide-edit-3": '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  "lucide-eye": '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  "lucide-file": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  "lucide-file-code": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m10 13-2 2 2 2"/><path d="m14 17 2-2-2-2"/>',
  "lucide-file-question": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M10 13a2 2 0 1 1 3.3 1.5c-.8.5-1.3 1-1.3 2"/><path d="M12 19h.01"/>',
  "lucide-file-search": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h6"/><path d="M14 2v6h6"/><circle cx="15" cy="15" r="3"/><path d="m17.5 17.5 3 3"/>',
  "lucide-folder": '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>',
  "lucide-folder-closed": '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M2 10h20"/>',
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
  "vault": '<path d="M21 19.2L21 4.8C21 3.47452 20.6046 3 19.5 3L4.5 3C3.39543 3 3 3.47452 3 4.8L3 19.2C3 20.5255 3.39543 21 4.5 21L19.5 21C20.6046 21 21 20.5255 21 19.2Z"/><path d="M14.9675 10.56C15.0601 11.1841 14.9535 11.8216 14.6629 12.3817C14.3722 12.9418 13.9124 13.396 13.3488 13.6797C12.7851 13.9634 12.1464 14.0621 11.5234 13.9619C10.9004 13.8616 10.3249 13.5675 9.87868 13.1213C9.43249 12.6751 9.13835 12.0996 9.0381 11.4766C8.93786 10.8536 9.0366 10.2149 9.3203 9.65123C9.60399 9.08759 10.0582 8.62776 10.6183 8.33713C11.1784 8.04651 11.8159 7.93989 12.4401 8.03245C13.0767 8.12687 13.6662 8.42355 14.1213 8.87868C14.5765 9.33381 14.8731 9.92326 14.9675 10.56Z"/><path d="M12 14L12 17"/><path d="M21 7L22.5 7"/><path d="M21 16L22.5 16"/>',
  "sheets-in-box": '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M7 7V3h10v4"/><path d="M8 12h8"/><path d="M8 16h8"/>',
  "sidebar-toggle-button-icon": '<rect x="1" y="2" width="22" height="20" rx="4"/><rect x="4" y="5" width="2" height="14" rx="2" fill="currentColor" class="sidebar-toggle-icon-inner"/>',
  "right-triangle": '<path d="M9 18 15 12 9 6z" fill="currentColor" stroke="none"/>',
  "lucide-bold": '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>',
  "lucide-bookmark": '<path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"/>',
  "lucide-bookmark-minus": '<path d="M15 10H9"/><path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"/>',
  "lucide-bookmark-plus": '<path d="M12 7v6"/><path d="M15 10H9"/><path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"/>',
  "lucide-box": '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  "lucide-box-select": '<path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M21 19a2 2 0 0 1-2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1"/><path d="M9 21h1"/><path d="M14 3h1"/><path d="M14 21h1"/><path d="M3 9v1"/><path d="M21 9v1"/><path d="M3 14v1"/><path d="M21 14v1"/>',
  "lucide-brackets": '<path d="M16 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-3"/><path d="M8 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h3"/>',
  "lucide-bug": '<path d="M12 20v-9"/><path d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z"/><path d="M14.12 3.88 16 2"/><path d="M21 21a4 4 0 0 0-3.81-4"/><path d="M21 5a4 4 0 0 1-3.55 3.97"/><path d="M22 13h-4"/><path d="M3 21a4 4 0 0 1 3.81-4"/><path d="M3 5a4 4 0 0 0 3.55 3.97"/><path d="M6 13H2"/><path d="m8 2 1.88 1.88"/><path d="M9 7.13V6a3 3 0 1 1 6 0v1.13"/>',
  "lucide-camera": '<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/>',
  "lucide-clipboard": '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  "lucide-code": '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  "lucide-columns": '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/>',
  "lucide-copy-check": '<path d="m12 15 2 2 4-4"/><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  "lucide-dices": '<rect width="12" height="12" x="2" y="10" rx="2" ry="2"/><path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6"/><path d="M6 18h.01"/><path d="M10 14h.01"/><path d="M15 6h.01"/><path d="M18 9h.01"/>',
  "lucide-diff": '<path d="M12 3v14"/><path d="M5 10h14"/><path d="M5 21h14"/>',
  "lucide-eraser": '<path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"/><path d="m5.082 11.09 8.828 8.828"/>',
  "lucide-external-link": '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  "lucide-file-plus": '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M9 15h6"/><path d="M12 18v-6"/>',
  "lucide-file-signature": '<path d="M14.364 13.634a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506l4.013-4.009a1 1 0 0 0-3.004-3.004z"/><path d="M14.487 7.858A1 1 0 0 1 14 7V2"/><path d="M20 19.645V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l2.516 2.516"/><path d="M8 18h1"/>',
  "lucide-files": '<path d="M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8"/><path d="M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z"/><path d="M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1"/>',
  "lucide-fold-vertical": '<path d="M12 22v-6"/><path d="M12 8V2"/><path d="M4 12H2"/><path d="M10 12H8"/><path d="M16 12h-2"/><path d="M22 12h-2"/><path d="m15 19-3-3-3 3"/><path d="m15 5-3 3-3-3"/>',
  "lucide-folder-open": '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  "lucide-folder-plus": '<path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  "lucide-git-branch": '<path d="M15 6a9 9 0 0 0-9 9V3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>',
  "lucide-grip-vertical": '<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
  "lucide-hard-drive": '<path d="M10 16h.01"/><path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M21.946 12.013H2.054"/><path d="M6 16h.01"/>',
  "lucide-heading": '<path d="M6 12h12"/><path d="M6 20V4"/><path d="M18 20V4"/>',
  "lucide-heart": '<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/>',
  "lucide-image-down": '<path d="M10.3 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10l-3.1-3.1a2 2 0 0 0-2.814.014L6 21"/><path d="m14 19 3 3v-5.5"/><path d="m17 22 3-3"/><circle cx="9" cy="9" r="2"/>',
  "lucide-import": '<path d="M12 3v12"/><path d="m8 11 4 4 4-4"/><path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4"/>',
  "lucide-indent": '<path d="M21 5H11"/><path d="M21 12H11"/><path d="M21 19H11"/><path d="m3 8 4 4-4 4"/>',
  "lucide-italic": '<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>',
  "lucide-layout-grid": '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  "lucide-list-ordered": '<path d="M11 5h10"/><path d="M11 12h10"/><path d="M11 19h10"/><path d="M4 4h1v5"/><path d="M4 9h2"/><path d="M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02"/>',
  "lucide-maximize": '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  "lucide-maximize-2": '<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/>',
  "lucide-mic": '<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>',
  "lucide-minimize-2": '<path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/>',
  "lucide-navigation": '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
  "lucide-orbit": '<path d="M20.341 6.484A10 10 0 0 1 10.266 21.85"/><path d="M3.659 17.516A10 10 0 0 1 13.74 2.152"/><circle cx="12" cy="12" r="3"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/>',
  "lucide-outdent": '<path d="M21 5H11"/><path d="M21 12H11"/><path d="M21 19H11"/><path d="m7 8-4 4 4 4"/>',
  "lucide-panel-left": '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  "lucide-panel-left-close": '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/>',
  "lucide-panel-right": '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
  "lucide-pencil": '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  "lucide-percent": '<line x1="19" x2="5" y1="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  "lucide-plus-circle": '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  "lucide-presentation": '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>',
  "lucide-quote": '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>',
  "lucide-rotate-ccw": '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  "lucide-ruler": '<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/>',
  "lucide-save": '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
  "lucide-scan": '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>',
  "lucide-scissors": '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',
  "lucide-search": '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
  "lucide-search-check": '<path d="m8 11 2 2 4-4"/><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  "lucide-send": '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  "lucide-sigma-square": '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M16 8.9V7H8l4 5-4 5h8v-1.9"/>',
  "lucide-sort-asc": '<path d="m3 8 4-4 4 4"/><path d="M7 4v16"/><path d="M11 12h4"/><path d="M11 16h7"/><path d="M11 20h10"/>',
  "lucide-square-dashed": '<path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M21 19a2 2 0 0 1-2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1"/><path d="M9 21h1"/><path d="M14 3h1"/><path d="M14 21h1"/><path d="M3 9v1"/><path d="M21 9v1"/><path d="M3 14v1"/><path d="M21 14v1"/>',
  "lucide-sticky-note": '<path d="M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z"/><path d="M15 3v5a1 1 0 0 0 1 1h5"/>',
  "lucide-table": '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
  "lucide-tag": '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  "lucide-text-cursor-input": '<path d="M12 20h-1a2 2 0 0 1-2-2 2 2 0 0 1-2 2H6"/><path d="M13 8h7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-7"/><path d="M5 16H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h1"/><path d="M6 4h1a2 2 0 0 1 2 2 2 2 0 0 1 2-2h1"/><path d="M9 6v12"/>',
  "lucide-trash": '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  "lucide-type": '<path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/>',
  "lucide-undo-2": '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  "lucide-unfold-vertical": '<path d="M12 22v-6"/><path d="M12 8V2"/><path d="M4 12H2"/><path d="M10 12H8"/><path d="M16 12h-2"/><path d="M22 12h-2"/><path d="m15 19-3 3-3-3"/><path d="m15 5-3-3-3 3"/>',
  "lucide-upload-cloud": '<path d="M12 13v8"/><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="m8 17 4-4 4 4"/>',
  "lucide-vault": '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/><path d="m7.9 7.9 2.7 2.7"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/><path d="m13.4 10.6 2.7-2.7"/><circle cx="7.5" cy="16.5" r=".5" fill="currentColor"/><path d="m7.9 16.1 2.7-2.7"/><circle cx="16.5" cy="16.5" r=".5" fill="currentColor"/><path d="m13.4 13.4 2.7 2.7"/><circle cx="12" cy="12" r="2"/>',
  "lucide-wrench": '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/>',
  "lucide-zoom-in": '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/>',
  "lucide-zoom-out": '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="8" x2="14" y1="11" y2="11"/>',
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
  return [...BUILTIN_ICONS.keys(), ...CUSTOM_ICONS.keys()];
}

export function removeIcon(iconId: string): void {
  CUSTOM_ICONS.delete(iconId);
}

export function setIcon(parent: HTMLElement, icon: string): SVGSVGElement | null {
  const normalizedIcon = normalizeIconName(icon);
  const definition = getIconDefinition(normalizedIcon);
  const firstChild = parent.firstChild;
  const SVG = parent.ownerDocument.defaultView?.SVGSVGElement;
  if (SVG && firstChild instanceof SVG && firstChild.classList.contains(icon)) return firstChild;
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

// Real `Ym`: legacy Obsidian icon names mapped to their Lucide targets, so
// e.g. setIcon(el, "create-new") resolves to lucide-edit. Identity aliases are
// omitted (they fall through unchanged).
const LEGACY_ICON_ALIASES: Record<string, string> = {
  "add-note-glyph": "file-plus",
  "any-key": "plus-circle",
  "audio-file": "file-audio",
  "blocks": "layout-list",
  "bold-glyph": "bold",
  "broken-link": "unlink",
  "bullet-list": "list",
  "bullet-list-glyph": "list",
  "calendar-glyph": "calendar-days",
  "calendar-with-checkmark": "calendar-check",
  "chat-bubbles-filled": "message-circle",
  "check-in-circle": "check-circle-2",
  "checkbox-glyph": "check-square",
  "checkmark": "check",
  "clock-glyph": "clock",
  "code-glyph": "code-2",
  "command-glyph": "terminal-square",
  "compress-glyph": "minimize-2",
  "create-new": "edit",
  "cross": "x",
  "cross-in-box": "x-square",
  "crossed-star": "star-off",
  "discord-filled": "discord",
  "document": "file",
  "documents": "files",
  "dot-network": "git-fork",
  "double-down-arrow-glyph": "chevrons-down",
  "double-up-arrow-glyph": "chevrons-up",
  "down-arrow-with-tail": "arrow-down",
  "down-chevron-glyph": "chevron-down",
  "down-curly-arrow-glyph": "corner-right-down",
  "duplicate-glyph": "copy",
  "enlarge-glyph": "maximize-2",
  "enter": "log-in",
  "exit-fullscreen": "minimize",
  "expand-vertically": "move-vertical",
  "experiment-filled": "experiment",
  "file-explorer-glyph": "files",
  "filled-pin": "pin",
  "folder": "folder-open",
  "forward-arrow": "forward",
  "fullscreen": "maximize",
  "gear": "settings",
  "github-glyph": "file-code",
  "go-to-file": "file-input",
  "graph-glyph": "git-fork",
  "hashtag": "hash",
  "highlight-glyph": "highlighter",
  "horizontal-split": "separator-horizontal",
  "image-file": "image",
  "image-glyph": "paperclip",
  "import-glyph": "download",
  "indent-glyph": "indent",
  "install": "download-cloud",
  "italic-glyph": "italic",
  "keyboard-glyph": "keyboard",
  "left-arrow": "chevron-left",
  "left-arrow-with-tail": "arrow-left",
  "left-chevron-glyph": "chevron-left",
  "lines-of-text": "align-left",
  "link-glyph": "link",
  "magnifying-glass": "search",
  "merge-files": "git-merge",
  "merge-files-glyph": "git-merge",
  "microphone": "mic",
  "microphone-filled": "mic",
  "minus-with-circle": "minus-circle",
  "navigate-glyph": "navigation",
  "note-glyph": "sticky-note",
  "number-list-glyph": "list-ordered",
  "open-elsewhere-glyph": "arrow-up-right",
  "pane-layout": "layout",
  "paper-plane": "send",
  "paper-plane-glyph": "send",
  "paste": "clipboard-check",
  "paste-text": "clipboard-type",
  "pdf-file": "file-text",
  "pencil": "edit-3",
  "percent-sign-glyph": "percent",
  "play-audio-glyph": "play-circle",
  "plus-minus-glyph": "diff",
  "plus-with-circle": "plus-circle",
  "popup-open": "arrow-up-right",
  "presentation": "monitor",
  "presentation-glyph": "monitor",
  "price-tag-glyph": "tag",
  "quote-glyph": "quote",
  "reading-glasses": "glasses",
  "redo-glyph": "redo-2",
  "reset": "rotate-ccw",
  "restore-file-glyph": "rotate-ccw",
  "right-arrow": "chevron-right",
  "right-arrow-with-tail": "arrow-right",
  "right-chevron-glyph": "chevron-right",
  "run-command": "terminal",
  "scissors-glyph": "scissors",
  "search-glyph": "search",
  "select-all-text": "box-select",
  "split": "git-branch-plus",
  "stacked-levels": "folder-tree",
  "star-glyph": "star",
  "stop-audio-glyph": "stop-circle",
  "strikethrough-glyph": "strikethrough",
  "switch": "repeat",
  "sync": "refresh-cw",
  "tag-glyph": "tag",
  "three-horizontal-bars": "menu",
  "tomorrow-glyph": "calendar-plus",
  "trash": "trash-2",
  "two-blank-pages": "copy",
  "two-columns": "columns",
  "undo-glyph": "undo-2",
  "unindent-glyph": "outdent",
  "up-and-down-arrows": "move-vertical",
  "up-arrow-with-tail": "arrow-up",
  "up-chevron-glyph": "chevron-up",
  "up-curly-arrow-glyph": "corner-right-up",
  "user-manual-filled": "book-open",
  "vertical-split": "separator-vertical",
  "vertical-three-dots": "more-vertical",
  "wand": "wand-2",
  "wand-glyph": "wand",
  "workspace-glyph": "layout",
  "wrench-screwdriver-glyph": "wrench",
  "box-glyph": "box",
  "bracket-glyph": "brackets",
  "heading-glyph": "heading",
  "yesterday-glyph": "calendar-minus",
};

function normalizeIconId(icon: string): string {
  return LEGACY_ICON_ALIASES[icon] ?? icon;
}

interface IconDefinition {
  content: string;
  custom: boolean;
}

function getIconDefinition(icon: string): IconDefinition | null {
  if (icon.startsWith("lucide-")) {
    const builtin = BUILTIN_ICONS.get(icon);
    return builtin == null ? null : { content: builtin, custom: false };
  }
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
