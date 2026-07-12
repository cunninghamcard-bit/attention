export interface DecorationSpec {
  class?: string;
  attributes?: Record<string, string>;
  widget?: WidgetType;
}

export abstract class WidgetType {
  abstract toDOM(): HTMLElement;
  eq(other: WidgetType): boolean { return other === this; }
  destroy(_dom: HTMLElement): void {}
}

export class Decoration {
  private constructor(readonly type: "mark" | "widget" | "line", readonly spec: DecorationSpec) {}

  static mark(spec: DecorationSpec): Decoration {
    return new Decoration("mark", spec);
  }

  static widget(spec: DecorationSpec & { widget: WidgetType }): Decoration {
    return new Decoration("widget", spec);
  }

  static line(spec: DecorationSpec): Decoration {
    return new Decoration("line", spec);
  }
}

export interface DecorationRange {
  from: number;
  to: number;
  decoration: Decoration;
}

export class DecorationSet {
  constructor(readonly ranges: DecorationRange[] = []) {}

  update(ranges: DecorationRange[]): DecorationSet {
    return new DecorationSet(ranges);
  }
}
