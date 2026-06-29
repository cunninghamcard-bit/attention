import type { GraphNode } from "./GraphDataEngine";

type Expr =
  | { type: "all" }
  | { type: "term"; operator: string | null; value: string; exact: boolean; regex: RegExp | null }
  | { type: "not"; child: Expr }
  | { type: "and"; children: Expr[] }
  | { type: "or"; children: Expr[] };

interface Token {
  type: "word" | "quoted" | "regex" | "or" | "not" | "lparen" | "rparen";
  value: string;
}

export interface CompiledGraphSearchQuery {
  raw: string;
  isEmpty: boolean;
  matchNode(node: GraphNode): boolean;
  matchFilepath(path: string): boolean;
  matchTag(tag: string): boolean;
}

export function compileGraphSearchQuery(raw: string): CompiledGraphSearchQuery {
  const tokens = tokenize(raw);
  const expr = tokens.length === 0 ? { type: "all" } satisfies Expr : new Parser(tokens).parse();
  return {
    raw,
    isEmpty: tokens.length === 0,
    matchNode: (node) => evaluate(expr, node),
    matchFilepath: (path) => evaluate(expr, createSyntheticNode(path, path.endsWith(".md") ? "file" : "attachment")),
    matchTag: (tag) => evaluate(expr, createSyntheticNode(tag.startsWith("#") ? tag : `#${tag}`, "tag")),
  };
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    const children = [this.parseAnd()];
    while (this.peek()?.type === "or") {
      this.consume();
      children.push(this.parseAnd());
    }
    return children.length === 1 ? children[0] : { type: "or", children };
  }

  private parseAnd(): Expr {
    const children: Expr[] = [];
    while (this.index < this.tokens.length) {
      const next = this.peek();
      if (!next || next.type === "rparen" || next.type === "or") break;
      children.push(this.parseUnary());
    }
    if (children.length === 0) return { type: "all" };
    return children.length === 1 ? children[0] : { type: "and", children };
  }

  private parseUnary(): Expr {
    if (this.peek()?.type === "not") {
      this.consume();
      return { type: "not", child: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const token = this.consume();
    if (!token) return { type: "all" };
    if (token.type === "lparen") {
      const child = this.parseOr();
      if (this.peek()?.type === "rparen") this.consume();
      return child;
    }
    return createTerm(token);
  }

  private peek(): Token | null {
    return this.tokens[this.index] ?? null;
  }

  private consume(): Token | null {
    return this.tokens[this.index++] ?? null;
  }
}

function tokenize(raw: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < raw.length) {
    const char = raw[index];
    if (/\s/.test(char)) {
      index++;
      continue;
    }
    if (char === "(") {
      tokens.push({ type: "lparen", value: char });
      index++;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "rparen", value: char });
      index++;
      continue;
    }
    if (char === "-") {
      tokens.push({ type: "not", value: char });
      index++;
      continue;
    }
    if (char === "\"") {
      const read = readUntil(raw, index + 1, "\"");
      tokens.push({ type: "quoted", value: read.value });
      index = read.next;
      continue;
    }
    if (char === "/") {
      const read = readUntil(raw, index + 1, "/");
      tokens.push({ type: "regex", value: read.value });
      index = read.next;
      continue;
    }

    const start = index;
    while (index < raw.length && !/\s|\(|\)/.test(raw[index])) index++;
    const value = raw.slice(start, index);
    tokens.push({ type: value.toUpperCase() === "OR" ? "or" : "word", value });
  }

  return tokens;
}

function readUntil(source: string, start: number, end: string): { value: string; next: number } {
  let value = "";
  let index = start;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\" && index + 1 < source.length) {
      value += source[index + 1];
      index += 2;
      continue;
    }
    if (char === end) return { value, next: index + 1 };
    value += char;
    index++;
  }
  return { value, next: index };
}

function createTerm(token: Token): Expr {
  const exact = token.type === "quoted";
  const regex = token.type === "regex" ? safeRegex(token.value) : null;
  let operator: string | null = null;
  let value = token.value;

  if (token.type === "word") {
    const colon = value.indexOf(":");
    if (colon > 0) {
      const candidate = value.slice(0, colon).toLowerCase();
      if (isSupportedOperator(candidate)) {
        operator = candidate;
        value = value.slice(colon + 1);
      }
    }
  }

  if (value.startsWith("[") && value.endsWith("]")) {
    operator = "property";
    value = value.slice(1, -1);
  }

  return { type: "term", operator, value, exact, regex };
}

function evaluate(expr: Expr, node: GraphNode): boolean {
  switch (expr.type) {
    case "all":
      return true;
    case "term":
      return matchTerm(expr, node);
    case "not":
      return !evaluate(expr.child, node);
    case "and":
      return expr.children.every((child) => evaluate(child, node));
    case "or":
      return expr.children.some((child) => evaluate(child, node));
  }
}

function matchTerm(term: Extract<Expr, { type: "term" }>, node: GraphNode): boolean {
  if (term.regex) return term.regex.test(node.id) || term.regex.test(node.label);
  const value = term.value.toLowerCase();
  if (!value) return true;

  switch (term.operator) {
    case "path":
      return matchText(node.id, value, term.exact);
    case "file":
      return node.type === "file" && matchText(node.label, value, term.exact);
    case "tag":
      return node.type === "tag" && matchText(node.id.replace(/^#/, ""), value.replace(/^#/, ""), term.exact);
    case "content":
    case "line":
    case "block":
    case "section":
      return node.type === "file" && (matchText(node.id, value, term.exact) || matchText(node.label, value, term.exact));
    case "task":
    case "task-todo":
    case "task-done":
      return false;
    case "match-case":
      return node.id.includes(term.value) || node.label.includes(term.value);
    case "ignore-case":
      return matchText(node.id, value, term.exact) || matchText(node.label, value, term.exact);
    case "property":
      return matchProperty(node, value);
    default:
      return matchText(node.id, value, term.exact) || matchText(node.label, value, term.exact) || matchText(node.type, value, term.exact);
  }
}

function matchText(haystack: string, needle: string, exact: boolean): boolean {
  const normalized = haystack.toLowerCase();
  return exact ? normalized.includes(needle) : normalized.includes(needle);
}

function matchProperty(node: GraphNode, value: string): boolean {
  const properties = node.properties ?? {};
  const expression = parsePropertyExpression(value);
  const actualKey = Object.keys(properties).find((propertyKey) => propertyKey.toLowerCase() === expression.key.toLowerCase());
  if (!actualKey) return false;
  if (expression.expected == null || expression.expected === "") return true;
  const actual = properties[actualKey];
  if (expression.comparator) return comparePropertyValue(actual, expression.expected, expression.comparator);
  if (expression.expected === "true") return actual === true;
  if (expression.expected === "false") return actual === false;
  if (expression.expected === "empty") return actual == null || actual === "" || Array.isArray(actual) && actual.length === 0;
  if (Array.isArray(actual)) return actual.some((item) => stringifyPropertyValue(item).toLowerCase().includes(expression.expected ?? ""));
  return stringifyPropertyValue(actual).toLowerCase().includes(expression.expected);
}

function parsePropertyExpression(value: string): { key: string; expected: string | null; comparator: ">" | "<" | null } {
  const comparison = value.match(/^(.+?)([<>])(.+)$/);
  if (comparison) {
    return { key: comparison[1].trim(), comparator: comparison[2] as ">" | "<", expected: comparison[3].trim().toLowerCase() };
  }
  const separator = value.indexOf(":");
  if (separator === -1) return { key: value.trim(), expected: null, comparator: null };
  return { key: value.slice(0, separator).trim(), expected: value.slice(separator + 1).trim().toLowerCase(), comparator: null };
}

function comparePropertyValue(actual: unknown, expected: string, comparator: ">" | "<"): boolean {
  const actualNumber = typeof actual === "number" ? actual : Number(stringifyPropertyValue(actual));
  const expectedNumber = Number(expected);
  if (!Number.isFinite(actualNumber) || !Number.isFinite(expectedNumber)) return false;
  return comparator === ">" ? actualNumber > expectedNumber : actualNumber < expectedNumber;
}

function stringifyPropertyValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function safeRegex(source: string): RegExp | null {
  try {
    return new RegExp(source, "i");
  } catch {
    return null;
  }
}

function createSyntheticNode(id: string, type: GraphNode["type"]): GraphNode {
  const label = id.split("/").pop()?.replace(/\.[^.]+$/, "") ?? id;
  return { id, label, type, resolved: true, x: 0, y: 0, links: 0, focused: false, colorClass: "color-fill" };
}

function isSupportedOperator(operator: string): boolean {
  return [
    "match-case",
    "ignore-case",
    "path",
    "file",
    "content",
    "line",
    "block",
    "section",
    "task",
    "task-todo",
    "task-done",
    "tag",
  ].includes(operator);
}
