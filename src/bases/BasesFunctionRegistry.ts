export interface BasesFunction {
  name: string;
  params?: readonly unknown[];
  docString?: unknown;
  apply?: (...args: any[]) => unknown;
  [key: string]: unknown;
}

export type BasesValueType = string | Function | object;

export class BasesFunctionRegistry {
  private readonly global: Record<string, BasesFunction> = Object.create(null);
  private readonly instance = new Map<BasesValueType, Record<string, BasesFunction>>();

  addGlobal(func: BasesFunction): void {
    this.global[normalizeFunctionName(func.name)] = func;
  }

  removeGlobal(name: string): void {
    delete this.global[normalizeFunctionName(name)];
  }

  getAllGlobal(): BasesFunction[] {
    return Object.values(this.global);
  }

  findGlobal(name: string): BasesFunction | null {
    return this.global[normalizeFunctionName(name)] ?? null;
  }

  addForType(type: BasesValueType, func: BasesFunction): void {
    let bucket = this.instance.get(type);
    if (!bucket) this.instance.set(type, (bucket = Object.create(null)));
    bucket[normalizeFunctionName(func.name)] = func;
  }

  removeForType(type: BasesValueType, name: string): void {
    const bucket = this.instance.get(type);
    if (!bucket) return;
    delete bucket[normalizeFunctionName(name)];
  }

  getAllForValue(value: unknown): Record<string, BasesFunction> {
    let funcs: Record<string, BasesFunction> = Object.create(null);
    for (const type of this.iterateValueTypes(value)) {
      const bucket = this.instance.get(type);
      if (bucket) funcs = { ...bucket, ...funcs };
    }
    return funcs;
  }

  findForValue(value: unknown, name: string): BasesFunction | null {
    const key = normalizeFunctionName(name);
    for (const type of this.iterateValueTypes(value)) {
      const bucket = this.instance.get(type);
      if (bucket && Object.hasOwn(bucket, key)) return bucket[key];
    }
    return null;
  }

  private iterateValueTypes(value: unknown): BasesValueType[] {
    const types: BasesValueType[] = [];
    const seen = new Set<unknown>();
    const add = (type: unknown) => {
      if ((typeof type === "string" || typeof type === "function" || isObjectType(type)) && !seen.has(type)) {
        seen.add(type);
        types.push(type);
      }
    };
    if (isObjectType(value) && "type" in value) add(value.type);
    const ctor = isObjectType(value) ? value.constructor : null;
    for (let current: unknown = ctor; typeof current === "function" && current !== Function.prototype; current = Object.getPrototypeOf(current)) {
      add(current);
      add((current as { type?: unknown }).type);
    }
    return types;
  }
}

function normalizeFunctionName(name: string): string {
  return name.toLowerCase();
}

function isObjectType(value: unknown): value is { [key: string]: unknown; constructor?: Function } {
  return (typeof value === "object" || typeof value === "function") && value !== null;
}
