export interface ViewUpdate {
  docChanged: boolean;
  selectionSet: boolean;
  viewportChanged: boolean;
}

export interface PluginValue {
  update?(update: ViewUpdate): void;
  destroy?(): void;
}

export class ViewPlugin<T extends PluginValue> {
  private constructor(readonly create: () => T) {}

  static fromClass<T extends PluginValue>(ctor: new () => T): ViewPlugin<T> {
    return new ViewPlugin(() => new ctor());
  }

  instantiate(): T {
    return this.create();
  }
}
