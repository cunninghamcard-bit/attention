/**
 * Input: ../app/App, ../ui/Modal, ../ui/Icon, ../ui/Popover, ../ui/Setting, ../ui/suggest/AbstractInputSuggest
 * Output: FontSettingKey, FontManagerModal, RibbonConfigurationModal, parseFontFamilies, fontAvailable, resetFontCatalogForTests
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

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
        // toggle, not `hidden`: extraSettingsEl is a `.clickable-icon`, whose
        // `display: flex` outranks `[hidden]` — the warning stayed lit on the
        // row permanently.
        this.warningEl.toggle(false);
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
      this.warningEl.toggle(false);
      return;
    }
    const available = await fontAvailable(trimmed, this.contentEl.ownerDocument);
    // The probe awaits document.fonts.ready, so by the time it resolves the
    // field may have been cleared or retyped — Add clears it. Only speak for
    // the value still in the box, or a stale answer re-lights the warning over
    // an empty field.
    if (this.fontInput?.getValue().trim() !== trimmed) return;
    this.warningEl?.toggle(!available);
  }

  private tryAddFont(): void {
    const value = this.fontInput?.getValue().trim() ?? "";
    if (value && !this.values.includes(value)) {
      this.values.push(value);
      this.display();
    }
    this.fontInput?.setValue("");
    this.warningEl?.toggle(false);
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
  const trimmed = font.trim();
  if (!trimmed) return true;
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  try {
    if (fonts?.ready) await fonts.ready;
  } catch {
    // Font loading API unavailable or rejected — the canvas probe below stands
    // on its own, it just may run before web fonts finish loading.
  }
  // The OS catalog is authoritative, and it sees what the canvas probe cannot:
  // fonts with no a-z0-9 glyphs to measure (Arabic, Syriac, Braille, dingbats).
  // Checking it first is what keeps those from reading as "not found".
  const catalog = await loadFontCatalog(doc);
  if (catalog.some((name) => name.toLowerCase() === trimmed.toLowerCase())) return true;
  // NOT document.fonts.check(): per spec it returns a vacuous TRUE for any
  // family with no matching @font-face — it treats the name as a system font
  // and assumes it resolves. Verified in Chromium: an invented name reports
  // available, so EVERY font read as "found" and the warning never appeared.
  // Measure instead, the same way the catalog does.
  const ctx = doc.createElement("canvas").getContext?.("2d");
  // No real canvas (jsdom): unmeasurable. Say nothing rather than claim a font
  // the user actually has is missing.
  if (!ctx) return true;
  return filterInstalledFontsWithCanvas(doc, [trimmed]).length > 0;
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
      // The OS list is authoritative and goes in UNFILTERED: a family the
      // platform enumerates is installed, full stop. The canvas probe is only a
      // guess for the seed names, and it structurally cannot see a font whose
      // a-z0-9 have no glyphs — measured against this machine's 187 real
      // families it dropped 18 of them (Geeza Pro, Noto Sans Syriac, Apple
      // Braille, Zapf Dingbats …), i.e. every Arabic / non-Latin / symbol font.
      // Filtering the OS list is how installed fonts went missing from search.
      const fromOs = await listSystemFontsFromBridge();
      const guessed = filterInstalledFontsWithCanvas(
        doc,
        uniqueFonts(["Inter", "Source Code Pro", ...SEED_FONTS]),
      );
      const catalog = uniqueFonts([...fromOs, ...guessed]);
      cachedFontCatalog = (catalog.length > 0 ? catalog : ["Inter", "Source Code Pro"]).sort(
        (a, b) => a.localeCompare(b),
      );
      return cachedFontCatalog;
    })();
  }
  return fontCatalogLoad;
}

/** Renderer side of Obsidian's `get-fonts` seam (`ipcRenderer.invoke("get-fonts")`). */
async function listSystemFontsFromBridge(): Promise<string[]> {
  const invoke = (
    globalThis as typeof globalThis & {
      electron?: {
        ipcRenderer?: { invoke?: (channel: string, ...args: unknown[]) => Promise<unknown> };
      };
    }
  ).electron?.ipcRenderer?.invoke;
  // No bridge at all is the browser build: an absent capability, not a failure.
  // There the canvas-probed seed list is legitimately the whole catalog.
  if (typeof invoke !== "function") return [];
  try {
    const fonts = await invoke("get-fonts");
    if (!Array.isArray(fonts)) return [];
    return fonts.map((font) => String(font).trim().replace(/^"|"$/g, "")).filter(Boolean);
  } catch (error) {
    // Loud on purpose. Swallowing this is exactly what made a broken bundle
    // look like a machine with no fonts installed — the picker quietly showed
    // only its hardcoded seeds and nothing anywhere said why.
    console.error("get-fonts failed; the font picker is limited to its seed list", error);
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

const FONT_PROBE_SAMPLE = "abcdefghijklmnopqrstuvwxyz0123456789";
/**
 * Three generics, not one. A family that IS the platform default for a generic
 * paints identically to it — `"Menlo", monospace` measures exactly `monospace`
 * on macOS — so a single monospace baseline silently drops the default of that
 * generic, i.e. most monospace fonts, which are exactly the ones a terminal or
 * a code block wants. A real font differs from at least one of the three.
 */
const FONT_PROBE_GENERICS = ["monospace", "sans-serif", "serif"] as const;

function filterInstalledFontsWithCanvas(doc: Document, fonts: string[]): string[] {
  try {
    const ctx = doc.createElement("canvas").getContext("2d");
    // Without a real canvas (jsdom/happy-dom), skip filtering and let the caller
    // fall back to OS list + anchors.
    if (!ctx) return [];
    const baselines = FONT_PROBE_GENERICS.map((generic) => {
      ctx.font = `72px ${generic}`;
      return ctx.measureText(FONT_PROBE_SAMPLE).width;
    });
    return fonts.filter((font) =>
      FONT_PROBE_GENERICS.some((generic, index) => {
        ctx.font = `72px "${font}", ${generic}`;
        return ctx.measureText(FONT_PROBE_SAMPLE).width !== baselines[index];
      }),
    );
  } catch {
    return [];
  }
}
