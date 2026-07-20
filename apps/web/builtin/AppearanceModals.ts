import type { App } from "../app/App";
import { ConfirmationModal } from "../ui/Modal";
import { setIcon } from "../ui/Icon";
import { setTooltip } from "../ui/Popover";
import { Setting, SettingGroup, type TextComponent } from "../ui/Setting";
import { AbstractInputSuggest } from "../ui/suggest/AbstractInputSuggest";

/**
 * Source-shaped seed list (Obsidian `jee` + Inter / Source Code Pro). Desktop also
 * merges `queryLocalFonts()` when Chromium exposes it, then canvas-filters the seed
 * so only families that actually resolve are suggested.
 */
const SEED_FONTS = [
  "Inter",
  "Source Code Pro",
  "Arial",
  "Arial Black",
  "Arial Narrow",
  "Arial Rounded MT Bold",
  "Arial Unicode MS",
  "American Typewriter",
  "Andale Mono",
  "Avenir",
  "Avenir Next",
  "Avenir Next Condensed",
  "Bahnschrift",
  "Baskerville",
  "Big Caslon",
  "Bodoni 72",
  "Bodoni 72 Oldstyle",
  "Bodoni 72 Smallcaps",
  "Bradley Hand",
  "Brush Script MT",
  "Calibri",
  "Cambria",
  "Cambria Math",
  "Candara",
  "Chalkboard",
  "Chalkboard SE",
  "Chalkduster",
  "Charter",
  "Cochin",
  "Comic Sans MS",
  "Consolas",
  "Constantia",
  "Copperplate",
  "Corbel",
  "Courier",
  "Courier New",
  "DIN Alternate",
  "DIN Condensed",
  "Didot",
  "Ebrima",
  "Franklin Gothic Medium",
  "Futura",
  "Gabriola",
  "Gadugi",
  "Geneva",
  "Georgia",
  "Gill Sans",
  "Helvetica",
  "Helvetica Neue",
  "Herculanum",
  "Hoefler Text",
  "HoloLens MDL2 Assets",
  "Impact",
  "Ink Free",
  "Javanese Text",
  "Leelawadee UI",
  "Lucida Console",
  "Lucida Grande",
  "Lucida Sans Unicode",
  "Luminari",
  "MS Gothic",
  "MV Boli",
  "Malgun Gothic",
  "Marker Felt",
  "Marlett",
  "Menlo",
  "Microsoft Himalaya",
  "Microsoft JhengHei",
  "Microsoft New Tai Lue",
  "Microsoft PhagsPa",
  "Microsoft Sans Serif",
  "Microsoft Tai Le",
  "Microsoft YaHei",
  "Microsoft Yi Baiti",
  "MingLiU-ExtB",
  "Monaco",
  "Mongolian Baiti",
  "Myanmar Text",
  "Nirmala UI",
  "Noteworthy",
  "Optima",
  "Palatino",
  "Palatino Linotype",
  "Papyrus",
  "Phosphate",
  "Rockwell",
  "Savoye LET",
  "Segoe MDL2 Assets",
  "Segoe Print",
  "Segoe Script",
  "Segoe UI",
  "Segoe UI Emoji",
  "Segoe UI Historic",
  "Segoe UI Symbol",
  "SignPainter",
  "SimSun",
  "Sitka",
  "Skia",
  "Snell Roundhand",
  "Sylfaen",
  "Symbol",
  "Tahoma",
  "Times",
  "Times New Roman",
  "Trattatello",
  "Trebuchet MS",
  "Verdana",
  "Webdings",
  "Wingdings",
  "Yu Gothic",
  "Zapfino",
];

export type FontSettingKey = "uiFont" | "textFont" | "monospaceFont";

let cachedFontCatalog: string[] | null = null;
let fontCatalogLoad: Promise<string[]> | null = null;

export class FontManagerModal extends ConfirmationModal {
  private values: string[];
  private fontSuggest: FontSuggest | null = null;
  private fontInput: TextComponent | null = null;
  private warningEl: HTMLElement | null = null;
  private readonly descEl: HTMLDivElement;
  private readonly fontListEl: HTMLDivElement;
  private draggedIndex = -1;

  constructor(
    app: App,
    title: string,
    value: string,
    private readonly onSave: (value: string) => void,
  ) {
    super(app);
    this.modalEl.classList.add("mod-font-manager");
    this.setTitle(title);
    this.values = parseFontFamilies(value);

    const doc = this.contentEl.ownerDocument;
    this.descEl = doc.createElement("div");
    this.fontListEl = doc.createElement("div");
    this.fontListEl.className = "setting-font-list";
    this.contentEl.append(this.descEl, this.fontListEl);
    this.buildAddForm();
    this.addButton("mod-cta", "Save", () => this.onSave(this.values.join(",")));
    this.addCancelButton();
  }

  override onOpen(): void {
    this.display();
  }

  override onClose(): void {
    this.fontSuggest?.close();
    super.onClose();
  }

  /** Source-shaped add form is built once; only the applied list is refreshed. */
  private buildAddForm(): void {
    new Setting(this.contentEl)
      .setName("Font name")
      .addExtraButton((button) => {
        this.warningEl = button.extraSettingsEl;
        button.setIcon("lucide-alert-circle").setTooltip("Font not found");
        this.warningEl.classList.add("mod-warning");
        this.warningEl.hidden = true;
      })
      .addText((text) => {
        this.fontInput = text;
        text.setPlaceholder("Enter a font name");
        // Suggestion Enter is consumed by keymap scope; pick must add the font.
        this.fontSuggest = new FontSuggest(this.app, text.inputEl, () => this.tryAddFont());
        text.onChange((value) => {
          void this.syncWarning(value);
        });
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.isComposing || event.key !== "Enter") return;
          // When the suggest popover is open, its scope owns Enter.
          if (this.fontSuggest?.isOpen) return;
          event.preventDefault();
          this.tryAddFont();
        });
      })
      .addButton((button) => button.setButtonText("Add").onClick(() => this.tryAddFont()));
  }

  private async syncWarning(value: string): Promise<void> {
    if (!this.warningEl) return;
    const trimmed = value.trim();
    if (!trimmed) {
      this.warningEl.hidden = true;
      return;
    }
    const available = await fontAvailable(trimmed, this.contentEl.ownerDocument);
    if (this.warningEl) this.warningEl.hidden = available;
  }

  private tryAddFont(): void {
    const value = this.fontInput?.getValue().trim() ?? "";
    if (value && !this.values.includes(value)) {
      this.values.push(value);
      this.display();
    }
    this.fontInput?.setValue("");
    if (this.warningEl) this.warningEl.hidden = true;
  }

  private display(): void {
    this.descEl.textContent = this.values.length ? "Font applied" : "No custom fonts are set.";
    this.fontListEl.replaceChildren();
    if (this.values.length === 0) return;

    const doc = this.contentEl.ownerDocument;
    this.values.forEach((font, index) => {
      const row = doc.createElement("div");
      row.className = "mobile-option-setting-item";
      const name = doc.createElement("span");
      name.className = "mobile-option-setting-item-name";
      name.textContent = font;
      name.style.fontFamily = font;
      const status = doc.createElement("span");
      status.className = "mobile-option-setting-item-option-icon";
      // Source: status icons resolve after `document.fonts.ready`.
      void fontAvailable(font, doc).then((available) => {
        if (status.classList.contains("mod-success") || status.classList.contains("mod-warning"))
          return;
        status.classList.add(available ? "mod-success" : "mod-warning");
        setIcon(status, available ? "lucide-check-circle-2" : "lucide-alert-circle");
        setTooltip(status, available ? "Font found" : "Font not found");
      });
      const remove = doc.createElement("div");
      remove.className = "clickable-icon mobile-option-setting-item-option-icon";
      setIcon(remove, "lucide-x");
      setTooltip(remove, "Delete font");
      remove.addEventListener("click", () => {
        this.values.splice(index, 1);
        this.display();
      });
      const drag = doc.createElement("div");
      drag.className =
        "clickable-icon mobile-option-setting-item-option-icon mobile-option-setting-drag-icon";
      drag.draggable = true;
      setIcon(drag, "lucide-menu");
      setTooltip(drag, "Drag to rearrange");
      drag.addEventListener("dragstart", () => {
        this.draggedIndex = index;
      });
      row.addEventListener("dragover", (event) => event.preventDefault());
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        if (this.draggedIndex < 0 || this.draggedIndex === index) return;
        const [moved] = this.values.splice(this.draggedIndex, 1);
        this.values.splice(index, 0, moved);
        this.draggedIndex = -1;
        this.display();
      });
      row.append(name, status, remove, drag);
      this.fontListEl.appendChild(row);
    });
  }
}

export class RibbonConfigurationModal extends ConfirmationModal {
  private draggedId: string | null = null;

  constructor(app: App) {
    super(app);
    this.modalEl.classList.add("mod-ribbon-manager", "mod-lg");
    this.setTitle("Configure ribbon");
    this.addButton("mod-cta", "Done", () => {});
  }

  override onOpen(): void {
    this.display();
  }

  private display(): void {
    this.contentEl.replaceChildren();
    const ribbon = this.app.workspace.leftRibbon;
    const description = this.contentEl.ownerDocument.createElement("p");
    description.textContent = "Choose which actions appear in the ribbon.";
    this.contentEl.appendChild(description);

    const visible = this.contentEl.ownerDocument.createElement("div");
    for (const item of ribbon.items.filter((entry) => !entry.hidden)) {
      visible.appendChild(this.createRibbonRow(item, false));
    }
    this.contentEl.appendChild(visible);
    const hidden = ribbon.items.filter((item) => item.hidden);
    if (hidden.length) {
      const group = new SettingGroup(this.contentEl).setHeading("Additional ribbon items");
      for (const item of hidden) group.listEl.appendChild(this.createRibbonRow(item, true));
    }
  }

  private createRibbonRow(
    item: { id: string; icon: string; title: string },
    hidden: boolean,
  ): HTMLElement {
    const doc = this.contentEl.ownerDocument;
    const row = doc.createElement("div");
    row.className = "mobile-option-setting-item";
    row.dataset.ribbonId = item.id;

    // Source uses bare add/remove icon spans (not option-icon) for visibility.
    const visibility = doc.createElement("span");
    visibility.className = hidden
      ? "mobile-option-setting-item-add-icon"
      : "mobile-option-setting-item-remove-icon";
    setIcon(visibility, hidden ? "lucide-plus-circle" : "lucide-minus-circle");
    setTooltip(visibility, hidden ? "Add to ribbon" : "Remove from ribbon");
    visibility.addEventListener("click", () => {
      this.app.workspace.leftRibbon.setItemHidden(item.id, !hidden);
      this.display();
    });

    const icon = doc.createElement("span");
    icon.className = "mobile-option-setting-item-option-icon";
    setIcon(icon, item.icon);
    const name = doc.createElement("span");
    name.className = "mobile-option-setting-item-name";
    name.textContent = item.title;
    row.append(visibility, icon, name);

    if (!hidden) {
      const drag = doc.createElement("div");
      drag.className =
        "clickable-icon mobile-option-setting-item-option-icon mobile-option-setting-drag-icon";
      drag.draggable = true;
      setIcon(drag, "lucide-menu");
      setTooltip(drag, "Drag to reorder");
      drag.addEventListener("dragstart", () => (this.draggedId = item.id));
      row.addEventListener("dragover", (event) => event.preventDefault());
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        if (!this.draggedId || this.draggedId === item.id) return;
        const rect = row.getBoundingClientRect();
        this.app.workspace.leftRibbon.moveRibbonItem(
          this.draggedId,
          item.id,
          event.clientY > rect.top + rect.height / 2,
        );
        this.draggedId = null;
        this.display();
      });
      row.appendChild(drag);
    }
    return row;
  }
}

class FontSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    inputEl: HTMLInputElement,
    private readonly onPick?: () => void,
  ) {
    super(app, inputEl);
  }

  getSuggestions(input: string): string[] {
    // Source uses case-insensitive substring match, not fuzzy scoring.
    // Serve the cached catalog (or anchors) synchronously so the popover can
    // open on the same input event; upgrade the cache in the background.
    const fonts = cachedFontCatalog ?? ["Inter", "Source Code Pro"];
    if (!cachedFontCatalog) {
      void loadFontCatalog(this.textInputEl.ownerDocument).then(() => {
        if (this.isOpen && isTextInputFocused(this.textInputEl)) this.onInputChange();
      });
    }
    const query = input.trim().toLowerCase();
    if (!query) {
      const rest = fonts.filter((font) => font !== "Inter");
      return ["Inter", ...rest].slice(0, 50);
    }
    return fonts.filter((font) => font.toLowerCase().includes(query)).slice(0, 50);
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    // Source: plain text + live font-family preview.
    el.textContent = value;
    el.style.fontFamily = value;
  }

  selectSuggestion(value: string, _event: MouseEvent | KeyboardEvent): void {
    this.setValue(value);
    this.textInputEl.dispatchEvent(new Event("input", { bubbles: true }));
    this.close();
    this.onPick?.();
  }
}

export function parseFontFamilies(value: string): string[] {
  return value
    .split(",")
    .map((font) => font.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

/** Source `Vee`: empty is available; otherwise wait for `document.fonts.ready`. */
export async function fontAvailable(font: string, doc: Document = document): Promise<boolean> {
  if (!font.trim()) return true;
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts?.check) return true;
  try {
    if (fonts.ready) await fonts.ready;
  } catch {
    // Font loading API unavailable or rejected — fall through to check.
  }
  try {
    return fonts.check(`12px "${font}"`);
  } catch {
    return false;
  }
}

/** Test/reset hook for the font catalog cache. */
export function resetFontCatalogForTests(): void {
  cachedFontCatalog = null;
  fontCatalogLoad = null;
}

async function loadFontCatalog(doc: Document): Promise<string[]> {
  if (cachedFontCatalog) return cachedFontCatalog;
  if (!fontCatalogLoad) {
    fontCatalogLoad = (async () => {
      // Source: OS fonts via get-fonts + seed list, then canvas-filter installed ones.
      const fromOs = await listSystemFontsFromBridge();
      const candidates = uniqueFonts(["Inter", "Source Code Pro", ...fromOs, ...SEED_FONTS]);
      const installed = filterInstalledFontsWithCanvas(doc, candidates);
      cachedFontCatalog = (
        installed.length > 0 ? installed : ["Inter", "Source Code Pro", ...fromOs]
      ).sort((a, b) => a.localeCompare(b));
      return cachedFontCatalog;
    })();
  }
  return fontCatalogLoad;
}

/** Renderer side of Obsidian's `get-fonts` seam (`ipcRenderer.invoke("get-fonts")`). */
async function listSystemFontsFromBridge(): Promise<string[]> {
  try {
    const electron = (
      globalThis as typeof globalThis & {
        electron?: {
          ipcRenderer?: { invoke?: (channel: string, ...args: unknown[]) => Promise<unknown> };
        };
      }
    ).electron;
    const fonts = await electron?.ipcRenderer?.invoke?.("get-fonts");
    if (!Array.isArray(fonts)) return [];
    return fonts.map((font) => String(font).trim().replace(/^"|"$/g, "")).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Source canvas probe: a family that paints wider/narrower than monospace is
 * treated as installed.
 */
function isTextInputFocused(el: HTMLElement): boolean {
  return el.ownerDocument.activeElement === el;
}

function uniqueFonts(fonts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const font of fonts) {
    if (!font || seen.has(font)) continue;
    seen.add(font);
    out.push(font);
  }
  return out;
}

function filterInstalledFontsWithCanvas(doc: Document, fonts: string[]): string[] {
  try {
    const canvas = doc.createElement("canvas");
    const ctx = canvas.getContext("2d");
    // Without a real canvas (jsdom/happy-dom), skip filtering and let the caller
    // fall back to OS list + anchors.
    if (!ctx) return [];
    const sample = "abcdefghijklmnopqrstuvwxyz0123456789";
    ctx.font = "72px monospace";
    const baseline = ctx.measureText(sample).width;
    const found: string[] = [];
    for (const font of fonts) {
      ctx.font = `72px "${font}", monospace`;
      if (ctx.measureText(sample).width !== baseline) found.push(font);
    }
    return found;
  } catch {
    return [];
  }
}
