import type { App } from "../app/App";
import { TFile, TFolder } from "../vault/TAbstractFile";
import { AbstractInputSuggest } from "./AbstractInputSuggest";
import { fuzzyMatch, prepareFuzzyQuery, renderFuzzyText, sortFuzzySuggestions, type FuzzyMatch } from "./SuggestModal";

export interface InputFileSuggestion<T extends TFile | TFolder> {
  item: T;
  match: FuzzyMatch;
}

export type FolderSuggestion = InputFileSuggestion<TFolder> | null;

export class FileInputSuggest extends AbstractInputSuggest<InputFileSuggestion<TFile>> {
  static readonly MAX_SUGGESTIONS = 100;

  renderSuggestion(value: InputFileSuggestion<TFile>, el: HTMLElement): void {
    el.classList.add("mod-nowrap");
    renderFuzzyText(el, this.getDisplayPath(value.item), value.match);
  }

  getSuggestions(inputStr: string): InputFileSuggestion<TFile>[] {
    const query = prepareFuzzyQuery(inputStr);
    const suggestions: InputFileSuggestion<TFile>[] = [];
    for (const file of this.app.vault.getAllLoadedFiles()) {
      if (suggestions.length >= FileInputSuggest.MAX_SUGGESTIONS) break;
      if (!(file instanceof TFile) || !this.filePredicate(file)) continue;
      const match = fuzzyMatch(query, file.path);
      if (match) suggestions.push({ item: file, match });
    }
    sortFuzzySuggestions(suggestions);
    return suggestions;
  }

  filePredicate(_file: TFile): boolean {
    return true;
  }

  override selectSuggestion(value: InputFileSuggestion<TFile>, event: MouseEvent | KeyboardEvent): void {
    this.setValue(this.getSelectedPath(value.item));
    triggerTextInputEvents(this.textInputEl, true);
    this.close();
  }

  protected getDisplayPath(file: TFile): string {
    return displayFilePath(file);
  }

  protected getSelectedPath(file: TFile): string {
    return displayFilePath(file);
  }
}

export class MarkdownFileInputSuggest extends FileInputSuggest {
  override filePredicate(file: TFile): boolean {
    return file.extension === "md";
  }
}

export class FilteredFileInputSuggest extends FileInputSuggest {
  constructor(app: App, textInputEl: HTMLInputElement | HTMLTextAreaElement | HTMLElement, readonly predicate?: (file: TFile) => boolean) {
    super(app, textInputEl);
  }

  override filePredicate(file: TFile): boolean {
    return !this.predicate || this.predicate(file);
  }
}

export class FullPathFileInputSuggest extends FilteredFileInputSuggest {
  protected override getDisplayPath(file: TFile): string {
    return file.path;
  }

  protected override getSelectedPath(file: TFile): string {
    return file.path;
  }
}

export class FolderInputSuggest extends AbstractInputSuggest<FolderSuggestion> {
  static readonly MAX_SUGGESTIONS = 100;
  includeRoot = false;

  constructor(app: App, textInputEl: HTMLInputElement | HTMLTextAreaElement | HTMLElement, readonly allowNullSelection = false, includeRoot = false) {
    super(app, textInputEl);
    this.includeRoot = includeRoot;
  }

  renderSuggestion(value: FolderSuggestion, el: HTMLElement): void {
    if (value) renderFuzzyText(el, value.item.path, value.match);
    else el.textContent = `+ ${this.getValue()}`;
  }

  getSuggestions(inputStr: string): FolderSuggestion[] {
    const query = prepareFuzzyQuery(inputStr);
    const suggestions: InputFileSuggestion<TFolder>[] = [];
    for (const folder of this.app.vault.getAllFolders(this.includeRoot)) {
      if (suggestions.length >= FolderInputSuggest.MAX_SUGGESTIONS) break;
      if (!this.filePredicate(folder)) continue;
      const match = fuzzyMatch(query, folder.path);
      if (match) suggestions.push({ item: folder, match });
    }
    sortFuzzySuggestions(suggestions);
    return this.allowNullSelection && inputStr ? [...suggestions, null] : suggestions;
  }

  filePredicate(_folder: TFolder): boolean {
    return true;
  }

  override selectSuggestion(value: FolderSuggestion, event: MouseEvent | KeyboardEvent): void {
    if (value) {
      this.setValue(value.item.path);
      triggerTextInputEvents(this.textInputEl, false);
    }
    this.close();
    super.selectSuggestion(value, event);
  }
}

export class FilteredFolderInputSuggest extends FolderInputSuggest {
  constructor(
    app: App,
    textInputEl: HTMLInputElement | HTMLTextAreaElement | HTMLElement,
    readonly folderPredicate?: (folder: TFolder) => boolean,
    allowNullSelection = false,
    includeRoot = false,
  ) {
    super(app, textInputEl, allowNullSelection, includeRoot);
  }

  override filePredicate(folder: TFolder): boolean {
    return !this.folderPredicate || this.folderPredicate(folder);
  }
}

function displayFilePath(file: TFile): string {
  return file.extension === "md" ? file.path.slice(0, -3) : file.path;
}

function triggerTextInputEvents(el: HTMLElement, includeChange: boolean): void {
  el.dispatchEvent(new Event("input", { bubbles: true }));
  if (includeChange) el.dispatchEvent(new Event("change", { bubbles: true }));
}
