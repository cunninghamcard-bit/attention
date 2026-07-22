export interface EditorPosition {
  line: number;
  ch: number;
}

export interface EditorRange {
  from: EditorPosition;
  to: EditorPosition;
}

export interface EditorRangeOrCaret {
  from: EditorPosition;
  to?: EditorPosition;
}

export interface EditorChange extends EditorRangeOrCaret {
  text: string;
}

export interface EditorSelection {
  anchor: EditorPosition;
  head: EditorPosition;
}

export interface EditorSelectionOrCaret {
  anchor: EditorPosition;
  head?: EditorPosition;
}

export interface EditorScrollInfo {
  left: number;
  top: number;
  width: number;
  height: number;
  clientWidth: number;
  clientHeight: number;
}

export type EditorCommandName =
  | "goUp"
  | "goDown"
  | "goLeft"
  | "goRight"
  | "goStart"
  | "goEnd"
  | "goWordLeft"
  | "goWordRight"
  | "indentMore"
  | "indentLess"
  | "newlineAndIndent"
  | "swapLineUp"
  | "swapLineDown"
  | "deleteLine"
  | "toggleFold"
  | "foldAll"
  | "unfoldAll";

export interface EditorTransaction {
  replaceSelection?: string;
  changes?: EditorChange[];
  selections?: EditorRangeOrCaret[];
  selection?: EditorRangeOrCaret;
}

export type EditorChangeListener = (editor: Editor, origin?: string) => void;
export type EditorSelectionListener = (editor: Editor) => void;

export abstract class Editor {
  private changeListeners = new Set<EditorChangeListener>();
  private selectionListeners = new Set<EditorSelectionListener>();
  private suppressChangeNotifications = 0;
  private suppressSelectionNotifications = 0;

  onChange(listener: EditorChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  onSelectionChange(listener: EditorSelectionListener): () => void {
    this.selectionListeners.add(listener);
    return () => this.selectionListeners.delete(listener);
  }

  protected changed(origin?: string): void {
    if (this.suppressChangeNotifications > 0) return;
    // oxlint-disable-next-line unicorn/no-useless-spread -- Listeners may unsubscribe during notification, so emit over a stable snapshot.
    for (const listener of [...this.changeListeners]) listener(this, origin);
  }

  protected selectionChanged(): void {
    if (this.suppressSelectionNotifications > 0) return;
    // oxlint-disable-next-line unicorn/no-useless-spread -- Listeners may unsubscribe during notification, so emit over a stable snapshot.
    for (const listener of [...this.selectionListeners]) listener(this);
  }

  protected withoutChangeNotifications<T>(callback: () => T): T {
    this.suppressChangeNotifications += 1;
    try {
      return callback();
    } finally {
      this.suppressChangeNotifications -= 1;
    }
  }

  protected withoutSelectionNotifications<T>(callback: () => T): T {
    this.suppressSelectionNotifications += 1;
    try {
      return callback();
    } finally {
      this.suppressSelectionNotifications -= 1;
    }
  }

  abstract getDoc(): this;
  abstract refresh(): void;
  abstract getValue(): string;
  abstract setValue(value: string, origin?: string): void;
  abstract setLine(line: number, text: string): void;
  abstract lineCount(): number;
  abstract lastLine(): number;
  abstract getSelection(): string;
  abstract somethingSelected(): boolean;
  abstract getRange(from: EditorPosition, to: EditorPosition): string;
  abstract replaceSelection(value: string, origin?: string): void;
  abstract getCursor(side?: "from" | "to" | "head" | "anchor"): EditorPosition;
  posAtCoords?(coords: { x: number; y: number }): EditorPosition | null;
  coordsAtPos?(pos: EditorPosition): Pick<DOMRect, "left" | "right" | "top" | "bottom"> | null;
  abstract listSelections(): EditorSelection[];
  abstract setCursor(position: EditorPosition | number, ch?: number): void;
  abstract setSelection(anchor: EditorPosition, head?: EditorPosition): void;
  abstract setSelections(ranges: EditorSelectionOrCaret[], main?: number): void;
  abstract getLine(line: number): string;
  abstract replaceRange(
    value: string,
    from: EditorPosition,
    to?: EditorPosition,
    origin?: string,
  ): void;
  abstract focus(): void;
  abstract blur(): void;
  abstract hasFocus(): boolean;
  abstract getScrollInfo(): EditorScrollInfo;
  abstract scrollTo(x?: number | null, y?: number | null): void;
  abstract scrollIntoView(range: EditorRange, center?: boolean): void;
  abstract undo(): void;
  abstract redo(): void;
  abstract exec(command: EditorCommandName): void;
  abstract transaction(tx: EditorTransaction, origin?: string): void;
  abstract wordAt(pos: EditorPosition): EditorRange | null;
  abstract posToOffset(pos: EditorPosition): number;
  abstract offsetToPos(offset: number): EditorPosition;
  abstract processLines<T>(
    read: (line: number, lineText: string) => T | null,
    write: (line: number, lineText: string, value: T | null) => EditorChange | void,
    ignoreEmpty?: boolean,
  ): void;
}

export class SimpleEditor extends Editor {
  private value = "";
  private selections: EditorSelection[] = [
    { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } },
  ];
  private mainSelection = 0;
  private focused = false;
  private scrollLeft = 0;
  private scrollTop = 0;

  constructor() {
    super();
  }

  getDoc(): this {
    return this;
  }
  refresh(): void {}
  getValue(): string {
    return this.value;
  }
  setValue(value: string, origin?: string): void {
    const previous = this.value;
    const previousSelection = this.selectionSignature();
    this.value = value;
    this.withoutSelectionNotifications(() => this.setCursor(this.clampPosition(this.getCursor())));
    if (previous !== value) this.changed(origin);
    if (previousSelection !== this.selectionSignature()) this.selectionChanged();
  }

  setLine(line: number, text: string): void {
    this.replaceRange(text, { line, ch: 0 }, { line, ch: this.getLine(line).length });
  }

  lineCount(): number {
    return this.lines().length;
  }
  lastLine(): number {
    return Math.max(0, this.lineCount() - 1);
  }

  getSelection(): string {
    const selection = this.getMainSelection();
    const range = sortRange(selection.anchor, selection.head);
    return this.getRange(range.from, range.to);
  }

  somethingSelected(): boolean {
    return this.listSelections().some(
      (selection) => comparePositions(selection.anchor, selection.head) !== 0,
    );
  }

  getRange(from: EditorPosition, to: EditorPosition): string {
    const range = sortRange(from, to);
    return this.value.slice(this.posToOffset(range.from), this.posToOffset(range.to));
  }

  replaceSelection(value: string, origin?: string): void {
    const previous = this.value;
    const previousSelection = this.selectionSignature();
    const selections = this.listSelections()
      .map((selection, index) => ({ index, range: sortRange(selection.anchor, selection.head) }))
      .sort((a, b) => this.posToOffset(b.range.from) - this.posToOffset(a.range.from));
    let mainCursor = 0;
    for (const selection of selections) {
      const start = this.posToOffset(selection.range.from);
      const end = this.posToOffset(selection.range.to);
      this.value = `${this.value.slice(0, start)}${value}${this.value.slice(end)}`;
      if (selection.index === this.mainSelection) mainCursor = start + value.length;
    }
    this.withoutSelectionNotifications(() => this.setCursor(this.offsetToPos(mainCursor)));
    if (previous !== this.value) this.changed(origin);
    if (previousSelection !== this.selectionSignature()) this.selectionChanged();
  }

  getCursor(side: "from" | "to" | "head" | "anchor" = "head"): EditorPosition {
    const selection = this.getMainSelection();
    if (side === "anchor") return clonePosition(selection.anchor);
    if (side === "head") return clonePosition(selection.head);
    const range = sortRange(selection.anchor, selection.head);
    return clonePosition(side === "from" ? range.from : range.to);
  }

  listSelections(): EditorSelection[] {
    return this.selections.map((selection) => ({
      anchor: clonePosition(selection.anchor),
      head: clonePosition(selection.head),
    }));
  }

  setCursor(position: EditorPosition | number, ch?: number): void {
    const previous = this.selectionSignature();
    const next = typeof position === "number" ? { line: position, ch: ch ?? 0 } : position;
    const cursor = this.clampPosition(next);
    this.selections = [{ anchor: cursor, head: cursor }];
    this.mainSelection = 0;
    if (previous !== this.selectionSignature()) this.selectionChanged();
  }

  setSelection(anchor: EditorPosition, head: EditorPosition = anchor): void {
    const previous = this.selectionSignature();
    this.selections = [
      {
        anchor: this.clampPosition(anchor),
        head: this.clampPosition(head),
      },
    ];
    this.mainSelection = 0;
    if (previous !== this.selectionSignature()) this.selectionChanged();
  }

  setSelections(ranges: EditorSelectionOrCaret[], main = 0): void {
    const previous = this.selectionSignature();
    const next = ranges.length > 0 ? ranges : [{ anchor: this.getCursor() }];
    this.selections = next.map((range) => ({
      anchor: this.clampPosition(range.anchor),
      head: this.clampPosition(range.head ?? range.anchor),
    }));
    this.mainSelection = Math.max(0, Math.min(main, this.selections.length - 1));
    if (previous !== this.selectionSignature()) this.selectionChanged();
  }

  getLine(line: number): string {
    return this.value.split(/\r?\n/)[line] ?? "";
  }
  replaceRange(
    value: string,
    from: EditorPosition,
    to: EditorPosition = from,
    origin?: string,
  ): void {
    const previous = this.value;
    const previousSelection = this.selectionSignature();
    const range = sortRange(from, to);
    const start = this.posToOffset(range.from);
    const end = this.posToOffset(range.to);
    this.value = `${this.value.slice(0, start)}${value}${this.value.slice(end)}`;
    this.withoutSelectionNotifications(() =>
      this.setCursor(this.offsetToPos(start + value.length)),
    );
    if (previous !== this.value) this.changed(origin);
    if (previousSelection !== this.selectionSignature()) this.selectionChanged();
  }

  focus(): void {
    this.focused = true;
  }
  blur(): void {
    this.focused = false;
  }
  hasFocus(): boolean {
    return this.focused;
  }

  getScrollInfo(): EditorScrollInfo {
    return {
      left: this.scrollLeft,
      top: this.scrollTop,
      width: 0,
      height: 0,
      clientWidth: 0,
      clientHeight: 0,
    };
  }

  scrollTo(x?: number | null, y?: number | null): void {
    if (typeof x === "number") this.scrollLeft = x;
    if (typeof y === "number") this.scrollTop = y;
  }

  scrollIntoView(_range: EditorRange, _center?: boolean): void {}
  undo(): void {}
  redo(): void {}

  exec(command: EditorCommandName): void {
    if (command === "goStart") this.setCursor(0, 0);
    else if (command === "goEnd")
      this.setCursor(this.lastLine(), this.getLine(this.lastLine()).length);
  }

  transaction(tx: EditorTransaction, origin?: string): void {
    const previous = this.value;
    const previousSelection = this.selectionSignature();
    this.withoutChangeNotifications(() => {
      this.withoutSelectionNotifications(() => {
        if (tx.replaceSelection !== undefined) this.replaceSelection(tx.replaceSelection, origin);
        if (tx.changes) {
          const changes = [...tx.changes].sort(
            (a, b) => this.posToOffset(b.from) - this.posToOffset(a.from),
          );
          let cursorOffset = this.posToOffset(this.getCursor());
          for (const change of changes) {
            const range = sortRange(change.from, change.to ?? change.from);
            const start = this.posToOffset(range.from);
            const end = this.posToOffset(range.to);
            this.value = `${this.value.slice(0, start)}${change.text}${this.value.slice(end)}`;
            cursorOffset = start + change.text.length;
          }
          this.setCursor(this.offsetToPos(cursorOffset));
        }
        if (tx.selections)
          this.setSelections(
            tx.selections.map((selection) => ({ anchor: selection.from, head: selection.to })),
          );
        else if (tx.selection) this.setSelection(tx.selection.from, tx.selection.to);
      });
    });
    if (previous !== this.value) this.changed(origin);
    if (previousSelection !== this.selectionSignature()) this.selectionChanged();
  }

  wordAt(pos: EditorPosition): EditorRange | null {
    const lineText = this.getLine(pos.line);
    if (!lineText) return null;
    const ch = Math.max(0, Math.min(pos.ch, lineText.length));
    const isWord = (char: string) => /[\p{L}\p{N}_-]/u.test(char);
    const index = ch < lineText.length && isWord(lineText[ch]) ? ch : ch - 1;
    if (index < 0 || !isWord(lineText[index])) return null;
    let from = index;
    let to = index + 1;
    while (from > 0 && isWord(lineText[from - 1])) from -= 1;
    while (to < lineText.length && isWord(lineText[to])) to += 1;
    return { from: { line: pos.line, ch: from }, to: { line: pos.line, ch: to } };
  }

  posToOffset(pos: EditorPosition): number {
    return positionToOffset(this.value, pos);
  }

  offsetToPos(offset: number): EditorPosition {
    return offsetToPosition(this.value, offset);
  }

  processLines<T>(
    read: (line: number, lineText: string) => T | null,
    write: (line: number, lineText: string, value: T | null) => EditorChange | void,
    ignoreEmpty = false,
  ): void {
    const changes: EditorChange[] = [];
    for (let line = 0; line < this.lineCount(); line += 1) {
      const lineText = this.getLine(line);
      if (ignoreEmpty && lineText.length === 0) continue;
      const value = read(line, lineText);
      const change = write(line, lineText, value);
      if (change) changes.push(change);
    }
    if (changes.length > 0) this.transaction({ changes });
  }

  private getMainSelection(): EditorSelection {
    return (
      this.selections[this.mainSelection] ?? {
        anchor: { line: 0, ch: 0 },
        head: { line: 0, ch: 0 },
      }
    );
  }

  private selectionSignature(): string {
    return `${this.mainSelection}:${this.selections
      .map(
        (selection) =>
          `${selection.anchor.line}:${selection.anchor.ch}:${selection.head.line}:${selection.head.ch}`,
      )
      .join("|")}`;
  }

  private lines(): string[] {
    return this.value.split(/\r?\n/);
  }

  private clampPosition(position: EditorPosition): EditorPosition {
    return offsetToPosition(this.value, positionToOffset(this.value, position));
  }
}

function positionToOffset(value: string, position: EditorPosition): number {
  const lines = value.split(/\r?\n/);
  const line = Math.max(0, Math.min(position.line, Math.max(0, lines.length - 1)));
  let offset = 0;
  for (let index = 0; index < line; index += 1) offset += lines[index].length + 1;
  const ch = Math.max(0, Math.min(position.ch, lines[line]?.length ?? 0));
  return Math.max(0, Math.min(value.length, offset + ch));
}

function offsetToPosition(value: string, offset: number): EditorPosition {
  const clamped = Math.max(0, Math.min(value.length, offset));
  const before = value.slice(0, clamped).split(/\r?\n/);
  return { line: before.length - 1, ch: before[before.length - 1]?.length ?? 0 };
}

function clonePosition(position: EditorPosition): EditorPosition {
  return { line: position.line, ch: position.ch };
}

function comparePositions(a: EditorPosition, b: EditorPosition): number {
  return a.line === b.line ? a.ch - b.ch : a.line - b.line;
}

function sortRange(from: EditorPosition, to: EditorPosition): EditorRange {
  return comparePositions(from, to) <= 0
    ? { from: clonePosition(from), to: clonePosition(to) }
    : { from: clonePosition(to), to: clonePosition(from) };
}
