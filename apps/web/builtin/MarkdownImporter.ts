import type { App } from "../app/App";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../plugin/InternalPluginWrapper";
import { ConfirmationModal } from "../ui/Modal";
import { Notice } from "../ui/Notice";
import { Setting, SettingGroup } from "../ui/Setting";

export interface MarkdownImportResult {
  processed: number;
  modified: number;
  replaced: number;
  failed: number;
}

interface MarkdownConverter {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  convert(source: string): MarkdownConversion;
}

interface MarkdownConversion {
  output: string;
  replaced: number;
}

export class MarkdownImporterController {
  constructor(readonly app: App) {}

  open(): void {
    new MarkdownImporterModal(this.app, this).open();
  }

  async process(converters: readonly MarkdownConverter[]): Promise<MarkdownImportResult> {
    const active = converters.filter((converter) => converter.enabled);
    const result: MarkdownImportResult = { processed: 0, modified: 0, replaced: 0, failed: 0 };
    for (const file of this.app.vault.getMarkdownFiles()) {
      result.processed += 1;
      try {
        let replacements = 0;
        await this.app.vault.process(file, (source) => {
          let output = source;
          for (const converter of active) {
            const converted = converter.convert(output);
            output = converted.output;
            replacements += converted.replaced;
          }
          return output;
        });
        if (replacements > 0) {
          result.modified += 1;
          result.replaced += replacements;
        }
      } catch (error) {
        result.failed += 1;
        console.error(`Markdown importer failed for ${file.path}`, error);
      }
    }
    this.app.workspace.trigger("markdown-import-complete", result);
    return result;
  }
}

class MarkdownImporterModal extends ConfirmationModal {
  private readonly converters = createConverters();
  private statusEl: HTMLElement | null = null;

  constructor(
    app: App,
    readonly controller: MarkdownImporterController,
  ) {
    super(app);
    this.setTitle("Markdown format converter");
    this.modalEl.classList.add("mod-markdown-importer");
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    this.contentEl.replaceChildren();
    const buttonEl = this.buttonContainerEl;
    buttonEl.replaceChildren();
    const warningEl = document.createElement("div");
    warningEl.className = "setting-message mod-warning";
    warningEl.textContent = "This will rewrite matching Markdown files in the vault.";
    this.contentEl.appendChild(warningEl);

    const group = new SettingGroup(this.contentEl).setHeading("Converters");
    for (const converter of this.converters) {
      new Setting(group.itemsEl)
        .setName(converter.name)
        .setDesc(converter.description)
        .addToggle((toggle) =>
          toggle.setValue(converter.enabled).onChange((enabled) => {
            converter.enabled = enabled;
          }),
        );
    }

    this.statusEl = document.createElement("div");
    this.statusEl.className = "changelog-item";
    this.contentEl.appendChild(this.statusEl);

    const convertButton = document.createElement("button");
    convertButton.className = "mod-cta";
    convertButton.textContent = "Convert";
    convertButton.addEventListener("click", () => void this.run(convertButton));
    const cancelButton = document.createElement("button");
    cancelButton.textContent = "Cancel";
    cancelButton.addEventListener("click", () => this.close());
    buttonEl.append(cancelButton, convertButton);
  }

  private async run(button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    this.setStatus("Processing Markdown files...", "mod-highlighted");
    const result = await this.controller.process(this.converters);
    const message = `Processed ${result.processed}, modified ${result.modified}, replacements ${result.replaced}, failed ${result.failed}.`;
    this.setStatus(message, result.failed ? "mod-failed" : "mod-success");
    new Notice(message);
    button.disabled = false;
  }

  private setStatus(message: string, className: string): void {
    if (!this.statusEl) return;
    this.statusEl.className = `changelog-item ${className}`;
    this.statusEl.textContent = message;
  }
}

function createConverters(): MarkdownConverter[] {
  return [
    {
      id: "roam-tags",
      name: "Roam Research tags",
      description: "Convert #[[tag]] and #[[nested tag]] to Obsidian tags.",
      enabled: true,
      convert: (source) =>
        replaceAll(
          source,
          /#\[\[([^\]]+)\]\]/g,
          (_match, tag: string) => `#${tag.trim().replace(/\s+/g, "-")}`,
        ),
    },
    {
      id: "roam-highlights",
      name: "Roam highlights",
      description: "Convert ^^highlight^^ to ==highlight==.",
      enabled: true,
      convert: (source) =>
        replaceAll(source, /\^\^([\s\S]*?)\^\^/g, (_match, text: string) => `==${text}==`),
    },
    {
      id: "roam-todos",
      name: "Roam todos",
      description: "Convert Roam TODO/DONE markers to Markdown task checkboxes.",
      enabled: true,
      convert: (source) =>
        replaceAll(source, /\{\{\[\[(TODO|DONE)\]\]\}\}/g, (_match, state: string) =>
          state === "DONE" ? "[x]" : "[ ]",
        ),
    },
    {
      id: "bear-highlights",
      name: "Bear highlights",
      description: "Convert ::highlight:: to ==highlight==.",
      enabled: true,
      convert: (source) =>
        replaceAll(source, /::([^:\n][\s\S]*?[^:\n])::/g, (_match, text: string) => `==${text}==`),
    },
    {
      id: "zettelkasten-links",
      name: "Zettelkasten links",
      description: "Convert [[UID Title]] links into [[UID Title|Title]] aliases.",
      enabled: false,
      convert: (source) =>
        replaceAll(
          source,
          /\[\[((?:\d{8,14})\s+([^\]|#]+))\]\]/g,
          (_match, full: string, title: string) => `[[${full}|${title.trim()}]]`,
        ),
    },
    {
      id: "frontmatter-tags",
      name: "Frontmatter tags",
      description: "Convert comma separated frontmatter tags into YAML list syntax.",
      enabled: false,
      convert: normalizeFrontmatterTags,
    },
  ];
}

function replaceAll(
  source: string,
  pattern: RegExp,
  replacer: (...args: string[]) => string,
): MarkdownConversion {
  let replaced = 0;
  const output = source.replace(pattern, (...args) => {
    replaced += 1;
    return replacer(...args.map(String));
  });
  return { output, replaced };
}

function normalizeFrontmatterTags(source: string): MarkdownConversion {
  const match = /^---\n([\s\S]*?)\n---/.exec(source);
  if (!match) return { output: source, replaced: 0 };
  const body = match[1];
  const next = body.replace(/^tags:\s*([^\n[{][^\n]*)$/m, (_line, tags: string) => {
    const items = tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (items.length === 0) return "tags: []";
    return `tags:\n${items.map((tag) => `  - ${tag}`).join("\n")}`;
  });
  if (next === body) return { output: source, replaced: 0 };
  return { output: source.replace(body, next), replaced: 1 };
}

export function createMarkdownImporterPluginDefinition(): InternalPluginDefinition {
  let controller: MarkdownImporterController | null = null;
  return {
    id: "markdown-importer",
    name: "Markdown format converter",
    description: "Convert Markdown exported from other apps into Obsidian-friendly Markdown.",
    defaultOn: false,
    init(app: App, plugin: InternalPluginWrapper) {
      controller = new MarkdownImporterController(app);
      plugin.instance = controller;
      plugin.registerGlobalCommand({
        id: "markdown-importer:open",
        name: "Open Markdown converter",
        icon: "lucide-import",
        callback: () => controller?.open(),
      });
      plugin.registerRibbonItem("Open Markdown converter", "lucide-import", () =>
        controller?.open(),
      );
    },
  };
}
