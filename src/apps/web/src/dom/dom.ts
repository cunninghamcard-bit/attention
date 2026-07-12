import { getActiveDocument } from "./ActiveDocument";

export type ClassValue = string | string[] | undefined;
export type AttributeValue = string | number | boolean | null | undefined;
export type DomParent = ParentNode & Node;
export interface DomElementInfo {
  parent?: DomParent;
  cls?: ClassValue;
  text?: string | Node | null;
  attr?: Record<string, AttributeValue>;
  type?: string;
  href?: string;
  title?: string;
  value?: string;
  placeholder?: string;
  prepend?: boolean;
}

export type DomElementSpec =
  | ClassValue
  | DomElementInfo
  | ((el: HTMLElement) => unknown)
  | undefined;
export type DomElementCallback<T extends HTMLElement> = (el: T) => unknown;

export function createDiv(
  spec?: DomElementSpec,
  parentOrCallback?: DomParent | DomElementCallback<HTMLDivElement>,
  callback?: DomElementCallback<HTMLDivElement>,
): HTMLDivElement {
  return createEl("div", spec, parentOrCallback, callback);
}

export function createSpan(
  spec?: DomElementSpec,
  parentOrCallback?: DomParent | DomElementCallback<HTMLSpanElement>,
  callback?: DomElementCallback<HTMLSpanElement>,
): HTMLSpanElement {
  return createEl("span", spec, parentOrCallback, callback);
}

export function createFragment(callback?: (frag: DocumentFragment) => unknown): DocumentFragment {
  const frag = getActiveDocument().createDocumentFragment();
  callback?.(frag);
  return frag;
}

export function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  spec?: DomElementSpec,
  parentOrCallback?: DomParent | DomElementCallback<HTMLElementTagNameMap[K]>,
  callback?: DomElementCallback<HTMLElementTagNameMap[K]>,
): HTMLElementTagNameMap[K] {
  const normalized = normalizeCreateArgs(spec, parentOrCallback, callback);
  const doc = normalized.parent ? getNodeDocument(normalized.parent) : getActiveDocumentLike();
  const el = doc.createElement(tag);
  applyElementInfo(el, normalized.spec);
  if (normalized.parent) appendToParent(normalized.parent, el, isPrependSpec(normalized.spec));
  normalized.callback?.(el);
  return el;
}

export function addClass(el: Element, cls?: ClassValue): void {
  if (!cls) return;
  const classes = Array.isArray(cls) ? cls : cls.split(/\s+/);
  const filtered = classes.map((name) => name.trim()).filter(Boolean);
  if (filtered.length > 0) el.classList.add(...filtered);
}

export function removeClass(el: Element, cls?: ClassValue): void {
  if (!cls) return;
  const classes = Array.isArray(cls) ? cls : cls.split(/\s+/);
  const filtered = classes.map((name) => name.trim()).filter(Boolean);
  if (filtered.length > 0) el.classList.remove(...filtered);
}

export function removeChildren(el: Node): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function setChildrenInPlace(parent: Node, children: Node[]): void {
  const nextChildren = new Set(children);
  for (const child of Array.from(parent.childNodes)) {
    if (!nextChildren.has(child)) child.parentNode?.removeChild(child);
  }
  children.forEach((child, index) => {
    const before = parent.childNodes.item(index);
    if (before !== child) parent.insertBefore(child, before);
  });
}

export function detach(el: Node | null | undefined): void {
  el?.parentNode?.removeChild(el);
}

export function installDomExtensions(win: Window & typeof globalThis = window): void {
  const nodeProto = win.Node?.prototype;
  const elementProto = win.Element?.prototype;
  if (!nodeProto || !elementProto) return;

  defineMethod(nodeProto, "createEl", function createElMethod<
    K extends keyof HTMLElementTagNameMap,
  >(this: ParentNode & Node, tag: K, spec?: DomElementSpec, callback?: DomElementCallback<HTMLElementTagNameMap[K]>): HTMLElementTagNameMap[K] {
    return createEl(tag, spec, this, callback);
  });
  defineMethod(
    nodeProto,
    "createDiv",
    function createDivMethod(
      this: ParentNode & Node,
      spec?: DomElementSpec,
      callback?: DomElementCallback<HTMLDivElement>,
    ): HTMLDivElement {
      return createEl("div", spec, this, callback);
    },
  );
  defineMethod(
    nodeProto,
    "createSpan",
    function createSpanMethod(
      this: ParentNode & Node,
      spec?: DomElementSpec,
      callback?: DomElementCallback<HTMLSpanElement>,
    ): HTMLSpanElement {
      return createEl("span", spec, this, callback);
    },
  );
  defineMethod(nodeProto, "appendText", function appendTextMethod(this: Node, text: string): Text {
    const textNode = getNodeDocument(this).createTextNode(text);
    this.appendChild(textNode);
    return textNode;
  });
  defineMethod(nodeProto, "empty", function emptyMethod(this: Node): Node {
    removeChildren(this);
    return this;
  });
  defineMethod(
    nodeProto,
    "setChildrenInPlace",
    function setChildrenInPlaceMethod(this: Node, children: Node[]): Node {
      setChildrenInPlace(this, children);
      return this;
    },
  );
  defineMethod(nodeProto, "detach", function detachMethod(this: Node): Node {
    detach(this);
    return this;
  });
  defineGetter(nodeProto, "doc", function docGetter(this: Node): Document {
    return getNodeDocument(this);
  });
  defineGetter(nodeProto, "win", function winGetter(this: Node): Window {
    return getNodeDocument(this).defaultView ?? win;
  });

  defineMethod(
    elementProto,
    "setText",
    function setTextMethod(this: Element, text: string): Element {
      this.textContent = text;
      return this;
    },
  );
  defineMethod(
    elementProto,
    "addClass",
    function addClassMethod(this: Element, cls: ClassValue): Element {
      addClass(this, cls);
      return this;
    },
  );
  defineMethod(
    elementProto,
    "addClasses",
    function addClassesMethod(this: Element, classes: string[]): Element {
      addClass(this, classes);
      return this;
    },
  );
  defineMethod(
    elementProto,
    "removeClass",
    function removeClassMethod(this: Element, cls: ClassValue): Element {
      removeClass(this, cls);
      return this;
    },
  );
  defineMethod(
    elementProto,
    "removeClasses",
    function removeClassesMethod(this: Element, classes: string[]): Element {
      removeClass(this, classes);
      return this;
    },
  );
  defineMethod(
    elementProto,
    "toggleClass",
    function toggleClassMethod(this: Element, cls: string, value?: boolean): Element {
      this.classList.toggle(cls, value);
      return this;
    },
  );
  defineMethod(
    elementProto,
    "hasClass",
    function hasClassMethod(this: Element, cls: string): boolean {
      return this.classList.contains(cls);
    },
  );
  defineMethod(
    elementProto,
    "setAttr",
    function setAttrMethod(this: Element, name: string, value: AttributeValue): Element {
      setAttributeValue(this, name, value);
      return this;
    },
  );
  defineMethod(
    elementProto,
    "getAttr",
    function getAttrMethod(this: Element, name: string): string {
      return this.getAttribute(name) ?? "";
    },
  );
  defineMethod(
    elementProto,
    "toggle",
    function toggleMethod(this: HTMLElement, show?: boolean): void {
      const visible = show ?? this.style.display === "none";
      this.style.display = visible ? "" : "none";
    },
  );
  defineMethod(elementProto, "show", function showMethod(this: HTMLElement): void {
    this.style.display = "";
  });
  defineMethod(elementProto, "hide", function hideMethod(this: HTMLElement): void {
    this.style.display = "none";
  });
  defineMethod(elementProto, "isShown", function isShownMethod(this: HTMLElement): boolean {
    if (!this.isConnected) return false;
    const view = this.ownerDocument.defaultView;
    return (view?.getComputedStyle(this).display ?? this.style.display) !== "none";
  });
  defineMethod(
    elementProto,
    "onNodeInserted",
    function onNodeInsertedMethod(
      this: Element,
      listener: () => unknown,
      once = false,
    ): () => void {
      const target = this;
      const doc = target.ownerDocument;
      const root = doc.documentElement ?? doc;
      const Observer = doc.defaultView?.MutationObserver ?? win.MutationObserver;
      if (!Observer) return () => {};
      let disposed = false;
      const cleanup = () => {
        disposed = true;
        observer.disconnect();
      };
      const runIfInserted = () => {
        if (disposed || !target.isConnected) return;
        listener();
        if (once) cleanup();
      };
      const observer = new Observer(runIfInserted);
      observer.observe(root, { childList: true, subtree: true });
      return cleanup;
    },
  );
  defineMethod(
    elementProto,
    "find",
    function findMethod(this: Element, selector: string): Element | null {
      return this.querySelector(selector);
    },
  );
  defineMethod(
    elementProto,
    "findAll",
    function findAllMethod(this: Element, selector: string): NodeListOf<Element> {
      return this.querySelectorAll(selector);
    },
  );
  defineMethod(
    elementProto,
    "on",
    function onMethod(
      this: Element,
      type: string,
      selector: string,
      listener: (event: Event, target: HTMLElement) => unknown,
    ): () => void {
      const handler = (event: Event) => {
        const target = event.target instanceof Element ? event.target.closest(selector) : null;
        if (target instanceof HTMLElement && this.contains(target)) listener(event, target);
      };
      this.addEventListener(type, handler);
      return () => this.removeEventListener(type, handler);
    },
  );
  defineMethod(
    elementProto,
    "onClickEvent",
    function onClickEventMethod(
      this: Element,
      listener: (event: MouseEvent) => unknown,
    ): () => void {
      const handler = (event: Event) => listener(event as MouseEvent);
      this.addEventListener("click", handler);
      return () => this.removeEventListener("click", handler);
    },
  );
  defineMethod(
    elementProto,
    "matchParent",
    function matchParentMethod(this: Element, selector: string): Element | null {
      return this.closest(selector);
    },
  );
  defineMethod(
    elementProto,
    "instanceOf",
    function instanceOfMethod(this: Element, constructor: typeof Element): boolean {
      return this instanceof constructor;
    },
  );
  defineMethod(elementProto, "getText", function getTextMethod(this: Element): string {
    return this.textContent ?? "";
  });
  defineMethod(
    elementProto,
    "setCssStyles",
    function setCssStylesMethod(this: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
      Object.assign(this.style, styles);
    },
  );
  defineMethod(
    elementProto,
    "setCssProps",
    function setCssPropsMethod(this: HTMLElement, props: Record<string, string>): void {
      for (const name of Object.keys(props)) this.style.setProperty(name, props[name]);
    },
  );
  defineMethod(
    elementProto,
    "toggleVisibility",
    function toggleVisibilityMethod(this: HTMLElement, visible: boolean): void {
      this.style.visibility = visible ? "" : "hidden";
    },
  );
  defineMethod(nodeProto, "insertAfter", function insertAfterMethod<
    T extends Node,
  >(this: Node, node: T, reference: Node | null): T {
    this.insertBefore(node, reference ? reference.nextSibling : this.firstChild);
    return node;
  });
}

declare global {
  interface Node {
    readonly doc: Document;
    readonly win: Window;
    createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      spec?: DomElementSpec,
      callback?: DomElementCallback<HTMLElementTagNameMap[K]>,
    ): HTMLElementTagNameMap[K];
    createDiv(spec?: DomElementSpec, callback?: DomElementCallback<HTMLDivElement>): HTMLDivElement;
    createSpan(
      spec?: DomElementSpec,
      callback?: DomElementCallback<HTMLSpanElement>,
    ): HTMLSpanElement;
    appendText(text: string): Text;
    empty(): this;
    setChildrenInPlace(children: Node[]): this;
    detach(): this;
    insertAfter<T extends Node>(node: T, reference: Node | null): T;
  }

  interface Element {
    setText(text: string): this;
    addClass(cls: ClassValue): this;
    addClasses(classes: string[]): this;
    removeClass(cls: ClassValue): this;
    removeClasses(classes: string[]): this;
    toggleClass(cls: string, value?: boolean): this;
    hasClass(cls: string): boolean;
    setAttr(name: string, value: AttributeValue): this;
    getAttr(name: string): string;
    toggle(show?: boolean): void;
    show(): void;
    hide(): void;
    isShown(): boolean;
    onNodeInserted(listener: () => unknown, once?: boolean): () => void;
    find(selector: string): Element | null;
    findAll(selector: string): NodeListOf<Element>;
    on(
      type: string,
      selector: string,
      listener: (event: Event, target: HTMLElement) => unknown,
    ): () => void;
    onClickEvent(listener: (event: MouseEvent) => unknown): () => void;
    matchParent(selector: string): Element | null;
    instanceOf(constructor: typeof Element): boolean;
    getText(): string;
    setCssStyles(styles: Partial<CSSStyleDeclaration>): void;
    setCssProps(props: Record<string, string>): void;
    toggleVisibility(visible: boolean): void;
  }
}

interface NormalizedCreateArgs<T extends HTMLElement> {
  spec: ClassValue | DomElementInfo | undefined;
  parent: DomParent | null;
  callback: DomElementCallback<T> | null;
}

function normalizeCreateArgs<T extends HTMLElement>(
  spec?: DomElementSpec,
  parentOrCallback?: DomParent | DomElementCallback<T>,
  callback?: DomElementCallback<T>,
): NormalizedCreateArgs<T> {
  let normalizedSpec: ClassValue | DomElementInfo | undefined =
    typeof spec === "function" ? undefined : spec;
  let normalizedParent: DomParent | null = isDomParent(parentOrCallback) ? parentOrCallback : null;
  let normalizedCallback: DomElementCallback<T> | null =
    typeof spec === "function" ? (spec as DomElementCallback<T>) : null;
  if (typeof parentOrCallback === "function") normalizedCallback = parentOrCallback;
  if (callback) normalizedCallback = callback;
  if (
    normalizedSpec &&
    typeof normalizedSpec === "object" &&
    !Array.isArray(normalizedSpec) &&
    "parent" in normalizedSpec
  ) {
    const candidate = normalizedSpec.parent;
    if (isDomParent(candidate)) normalizedParent = candidate;
  }
  return { spec: normalizedSpec, parent: normalizedParent, callback: normalizedCallback };
}

function applyElementInfo(el: HTMLElement, spec: ClassValue | DomElementInfo | undefined): void {
  if (!spec) return;
  if (typeof spec === "string" || Array.isArray(spec)) {
    addClass(el, spec);
    return;
  }
  addClass(el, spec.cls);
  if (spec.text instanceof Node) el.appendChild(spec.text);
  else if (spec.text != null) el.textContent = spec.text;
  if (spec.type != null) setAttributeValue(el, "type", spec.type);
  if (spec.href != null) setAttributeValue(el, "href", spec.href);
  if (spec.title != null) setAttributeValue(el, "title", spec.title);
  if (spec.placeholder != null) setAttributeValue(el, "placeholder", spec.placeholder);
  if (spec.value != null) {
    if ("value" in el) (el as HTMLInputElement).value = spec.value;
    else setAttributeValue(el, "value", spec.value);
  }
  for (const [name, value] of Object.entries(spec.attr ?? {})) setAttributeValue(el, name, value);
}

function setAttributeValue(el: Element, name: string, value: AttributeValue): void {
  if (value == null) {
    el.removeAttribute(name);
    return;
  }
  el.setAttribute(name, value === true ? "" : String(value));
}

function appendToParent(parent: DomParent, el: HTMLElement, prepend: boolean): void {
  if (prepend) parent.prepend(el);
  else parent.appendChild(el);
}

function isPrependSpec(spec: ClassValue | DomElementInfo | undefined): boolean {
  return typeof spec === "object" && !Array.isArray(spec) && spec?.prepend === true;
}

function getActiveDocumentLike(): Document {
  if (typeof document !== "undefined") return getActiveDocument();
  throw new Error("No active document");
}

function getNodeDocument(node: Node): Document {
  if (isDocumentNode(node)) return node;
  return node.ownerDocument ?? getActiveDocumentLike();
}

function isDomParent(value: unknown): value is DomParent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { appendChild?: unknown }).appendChild === "function"
  );
}

function isDocumentNode(node: Node): node is Document {
  return node.nodeType === 9 && typeof (node as Document).createElement === "function";
}

function defineMethod(proto: object, name: string, value: unknown): void {
  if (name in proto) return;
  Object.defineProperty(proto, name, { configurable: true, value });
}

function defineGetter(proto: object, name: string, get: () => unknown): void {
  if (name in proto) return;
  Object.defineProperty(proto, name, { configurable: true, get });
}

if (typeof window !== "undefined") installDomExtensions(window);
