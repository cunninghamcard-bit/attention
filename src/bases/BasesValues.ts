import type { App } from "../app/App";
import type { RenderContext } from "../markdown/RenderContext";

export abstract class Value {
  static type = "value";

  static equals(a: Value | null, b: Value | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.equals(b as never);
  }

  static looseEquals(a: Value | null, b: Value | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.looseEquals(b);
  }

  abstract toString(): string;
  abstract isTruthy(): boolean;

  equals(other: this): boolean {
    return this.constructor === other.constructor && this.toString() === other.toString();
  }

  looseEquals(other: Value): boolean {
    return this.toString() === other.toString();
  }

  renderTo(el: HTMLElement, _ctx: RenderContext): void {
    el.textContent = this.toString();
  }
}

export abstract class NotNullValue extends Value {}

export class NullValue extends Value {
  static value = new NullValue();
  static override type = "null";

  toString(): string {
    return "";
  }

  isTruthy(): boolean {
    return false;
  }

  override equals(other: this): boolean {
    return other instanceof NullValue;
  }

  override looseEquals(other: Value): boolean {
    return other instanceof NullValue || other.toString() === "";
  }
}

export abstract class PrimitiveValue<T> extends NotNullValue {
  constructor(readonly value: T) {
    super();
  }

  toString(): string {
    return String(this.value);
  }

  isTruthy(): boolean {
    return Boolean(this.value);
  }

  override equals(other: this): boolean {
    return other instanceof PrimitiveValue && this.constructor === other.constructor && Object.is(this.value, other.value);
  }
}

export class StringValue extends PrimitiveValue<string> {
  static override type = "string";
}

export class NumberValue extends PrimitiveValue<number> {
  static override type = "number";
}

export class BooleanValue extends PrimitiveValue<boolean> {
  static override type = "boolean";
}

export class UrlValue extends StringValue {
  static override type = "url";
}

export class HTMLValue extends StringValue {
  static override type = "html";
}

export class IconValue extends StringValue {
  static override type = "icon";
}

export class ImageValue extends StringValue {
  static override type = "image";
}

export class TagValue extends StringValue {
  static override type = "tag";
}

export class LinkValue extends StringValue {
  static override type = "link";

  constructor(value: string, readonly displayText?: string, readonly sourcePath = "") {
    super(value);
  }

  static parseFromString(_app: App, input: string, sourcePath: string): LinkValue | null {
    const match = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/.exec(input.trim());
    if (!match) return null;
    return new LinkValue(match[1], match[2], sourcePath);
  }

  override renderTo(el: HTMLElement, _ctx: RenderContext): void {
    const linkEl = el.ownerDocument.createElement("span");
    linkEl.className = "internal-link";
    linkEl.dataset.href = this.value;
    if (this.sourcePath) linkEl.dataset.sourcePath = this.sourcePath;
    linkEl.textContent = this.displayText ?? this.value;
    el.replaceChildren(linkEl);
  }
}

export class DateValue extends NotNullValue {
  static type = "date";

  constructor(readonly value: Date) {
    super();
  }

  static parseFromString(input: string): DateValue | null {
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? null : new DateValue(date);
  }

  toString(): string {
    const iso = this.value.toISOString();
    return isUtcMidnight(this.value) ? iso.slice(0, 10) : iso.replace(/\.\d{3}Z$/, "Z");
  }

  dateOnly(): DateValue {
    return new DateValue(new Date(Date.UTC(this.value.getUTCFullYear(), this.value.getUTCMonth(), this.value.getUTCDate())));
  }

  relative(): string {
    const today = new Date();
    const thisDay = Date.UTC(this.value.getUTCFullYear(), this.value.getUTCMonth(), this.value.getUTCDate());
    const todayDay = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const delta = Math.round((thisDay - todayDay) / 86400000);
    if (delta === 0) return "today";
    if (delta === 1) return "tomorrow";
    if (delta === -1) return "yesterday";
    return delta > 0 ? `in ${delta} days` : `${Math.abs(delta)} days ago`;
  }

  isTruthy(): boolean {
    return !Number.isNaN(this.value.getTime());
  }

  override equals(other: this): boolean {
    return other instanceof DateValue && this.value.getTime() === other.value.getTime();
  }
}

export class RelativeDateValue extends DateValue {
  static override type = "relative-date";

  override toString(): string {
    return this.relative();
  }
}

export class DurationValue extends NotNullValue {
  static type = "duration";

  constructor(readonly milliseconds: number) {
    super();
  }

  static parseFromString(input: string): DurationValue | null {
    const match = /^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(input.trim());
    if (!match) return null;
    const [, weeks, days, hours, minutes, seconds] = match;
    const total =
      Number(weeks ?? 0) * 604800000
      + Number(days ?? 0) * 86400000
      + Number(hours ?? 0) * 3600000
      + Number(minutes ?? 0) * 60000
      + Number(seconds ?? 0) * 1000;
    return Number.isFinite(total) ? new DurationValue(total) : null;
  }

  static fromMilliseconds(milliseconds: number): DurationValue {
    return new DurationValue(milliseconds);
  }

  toString(): string {
    return millisecondsToIsoDuration(this.milliseconds);
  }

  isTruthy(): boolean {
    return this.milliseconds !== 0 && Number.isFinite(this.milliseconds);
  }

  addToDate(value: DateValue, subtract = false): DateValue {
    const offset = subtract ? -this.milliseconds : this.milliseconds;
    return new DateValue(new Date(value.value.getTime() + offset));
  }

  getMilliseconds(): number {
    return this.milliseconds;
  }

  override equals(other: this): boolean {
    return other instanceof DurationValue && this.milliseconds === other.milliseconds;
  }
}

export class FileValue extends NotNullValue {
  static type = "file";

  constructor(readonly path: string) {
    super();
  }

  toString(): string {
    return this.path;
  }

  isTruthy(): boolean {
    return this.path.length > 0;
  }

  override equals(other: this): boolean {
    return other instanceof FileValue && other.path === this.path;
  }
}

export class RegExpValue extends NotNullValue {
  static type = "regexp";

  constructor(readonly value: RegExp | string) {
    super();
  }

  toString(): string {
    return this.value instanceof RegExp ? this.value.toString() : this.value;
  }

  isTruthy(): boolean {
    return this.toString().length > 0;
  }

  override equals(other: this): boolean {
    return other instanceof RegExpValue && other.toString() === this.toString();
  }
}

export class ListValue extends NotNullValue {
  static type = "list";

  constructor(readonly value: (unknown | Value)[]) {
    super();
  }

  toString(): string {
    return this.value.map((_, index) => this.get(index).toString()).join(", ");
  }

  isTruthy(): boolean {
    return this.value.length > 0;
  }

  includes(value: Value): boolean {
    return this.value.some((_, index) => this.get(index).looseEquals(value));
  }

  length(): number {
    return this.value.length;
  }

  get(index: number): Value {
    if (index < 0 || index >= this.value.length) return NullValue.value;
    const current = this.value[index];
    if (current instanceof Value) return current;
    const converted = valueFromUnknown(current);
    this.value[index] = converted;
    return converted;
  }

  concat(other: ListValue): ListValue {
    return new ListValue([...this.value, ...other.value]);
  }

  override equals(other: this): boolean {
    if (!(other instanceof ListValue) || this.length() !== other.length()) return false;
    return this.value.every((_, index) => this.get(index).equals(other.get(index) as never));
  }
}

export class ObjectValue extends NotNullValue {
  static type = "object";

  constructor(readonly value: Record<string, unknown | Value>) {
    super();
  }

  toString(): string {
    return JSON.stringify(this.value);
  }

  isTruthy(): boolean {
    return Object.keys(this.value).length > 0;
  }

  isEmpty(): boolean {
    return Object.keys(this.value).length === 0;
  }

  get(key: string): Value | null {
    if (!Object.prototype.hasOwnProperty.call(this.value, key)) return NullValue.value;
    const current = this.value[key];
    if (current instanceof Value) return current;
    const converted = valueFromUnknown(current);
    this.value[key] = converted;
    return converted;
  }
}

export function valueFromUnknown(value: unknown): Value {
  if (value instanceof Value) return value;
  if (value == null) return NullValue.value;
  if (typeof value === "string") return new StringValue(value);
  if (typeof value === "number") return new NumberValue(value);
  if (typeof value === "boolean") return new BooleanValue(value);
  if (value instanceof Date) return new DateValue(value);
  if (value instanceof RegExp) return new RegExpValue(value);
  if (Array.isArray(value)) return new ListValue(value);
  if (typeof value === "object") return new ObjectValue(value as Record<string, unknown>);
  return new StringValue(String(value));
}

function isUtcMidnight(date: Date): boolean {
  return date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
}

function millisecondsToIsoDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds === 0) return "PT0S";
  const sign = milliseconds < 0 ? "-" : "";
  let remaining = Math.abs(milliseconds);
  const days = Math.floor(remaining / 86400000);
  remaining -= days * 86400000;
  const hours = Math.floor(remaining / 3600000);
  remaining -= hours * 3600000;
  const minutes = Math.floor(remaining / 60000);
  remaining -= minutes * 60000;
  const seconds = remaining / 1000;
  const date = days ? `${days}D` : "";
  const timeParts = [
    hours ? `${hours}H` : "",
    minutes ? `${minutes}M` : "",
    seconds ? `${Number.isInteger(seconds) ? seconds : Number(seconds.toFixed(3))}S` : "",
  ].join("");
  return `${sign}P${date}${timeParts ? `T${timeParts}` : date ? "" : "T0S"}`;
}
