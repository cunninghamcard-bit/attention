import type { EventRef } from "./Events";
import { unregisterEventRef } from "./EventRefInternal";
import type { KeymapEventHandler } from "../hotkeys/Scope";

export class Component {
  _loaded = false;
  _children: Component[] = [];
  _events: Array<() => void> = [];

  load(): void | Promise<void> {
    if (this._loaded) return;
    this._loaded = true;
    const promises: unknown[] = [];
    const onloadResult = this.onload();
    if (onloadResult) promises.push(onloadResult);
    for (const child of this._children.slice()) {
      const childResult = child.load();
      if (childResult) promises.push(childResult);
    }
    if (promises.length > 0) return Promise.all(promises).then(() => {});
  }

  unload(): void {
    if (!this._loaded) return;
    this._loaded = false;
    while (this._children.length > 0) this._children.pop()?.unload();
    while (this._events.length > 0) this._events.pop()?.();
    this.onunload();
  }

  onload(): any {}
  onunload(): any {}

  addChild<T extends Component>(child: T): T {
    this._children.push(child);
    if (this._loaded) child.load();
    return child;
  }

  removeChild<T extends Component>(child: T): T {
    const index = this._children.indexOf(child);
    if (index !== -1) {
      this._children.splice(index, 1);
      child.unload();
    }
    return child;
  }

  register(cleanup: () => void): void {
    this._events.push(cleanup);
  }

  registerEvent(ref: EventRef): void {
    this.register(() => {
      unregisterEventRef(ref);
    });
  }

  registerDomEvent<K extends keyof WindowEventMap>(
    el: Window,
    type: K,
    callback: (this: HTMLElement, event: WindowEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  registerDomEvent<K extends keyof DocumentEventMap>(
    el: Document,
    type: K,
    callback: (this: HTMLElement, event: DocumentEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  registerDomEvent<K extends keyof HTMLElementEventMap>(
    el: HTMLElement,
    type: K,
    callback: (this: HTMLElement, event: HTMLElementEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  registerDomEvent(
    el: HTMLElement | Document | Window,
    type: string,
    callback: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    el.addEventListener(type, callback, options);
    this.register(() => el.removeEventListener(type, callback, options));
  }

  registerScopeEvent(ref: KeymapEventHandler): void {
    this.register(() => ref.scope.unregister(ref));
  }

  registerInterval(id: number): number {
    this.register(() => window.clearInterval(id));
    return id;
  }
}
