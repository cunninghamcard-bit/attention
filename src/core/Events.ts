declare const eventRefBrand: unique symbol;

export type EventHandler<TArgs extends unknown[] = unknown[]> = (...args: TArgs) => unknown;
export interface EventRef<TArgs extends unknown[] = unknown[]> {
  readonly [eventRefBrand]?: TArgs;
}

interface EventRefRecord<TArgs extends unknown[] = unknown[]> extends EventRef<TArgs> {
  e: Events;
  name: string;
  fn: EventHandler<TArgs>;
  ctx: unknown;
}

export class Events {
  private handlers = new Map<string, EventRefRecord[]>();

  on<TArgs extends unknown[]>(name: string, handler: EventHandler<TArgs>, ctx?: unknown): EventRef<TArgs> {
    let bucket = this.handlers.get(name);
    if (!bucket) this.handlers.set(name, (bucket = []));
    const ref: EventRefRecord<TArgs> = { e: this, name, fn: handler, ctx };
    bucket.push(ref as EventRefRecord);
    return ref;
  }

  off(name: string, handler?: EventHandler): void {
    const bucket = this.handlers.get(name);
    if (!bucket) return;
    if (!handler) {
      this.handlers.delete(name);
      return;
    }
    const next = bucket.filter((ref) => ref.fn !== handler);
    if (next.length > 0) this.handlers.set(name, next);
    else this.handlers.delete(name);
  }

  offref(ref: EventRef | null | undefined): void {
    if (!ref) return;
    const record = ref as EventRefRecord;
    const bucket = this.handlers.get(record.name);
    if (!bucket) return;
    const next = bucket.filter((item) => item !== ref);
    if (next.length > 0) this.handlers.set(record.name, next);
    else this.handlers.delete(record.name);
  }

  trigger(name: string, ...args: unknown[]): void {
    for (const ref of [...this.handlers.get(name) ?? []]) this.tryTrigger(ref, args);
  }

  tryTrigger(ref: EventRef, args: unknown[] = []): void {
    const record = ref as EventRefRecord;
    try {
      record.fn.apply(record.ctx, args);
    } catch (error) {
      setTimeout(() => {
        throw error;
      }, 0);
    }
  }
}
