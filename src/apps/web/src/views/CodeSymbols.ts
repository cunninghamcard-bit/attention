import { syntaxTree } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

/**
 * Code symbols for the outline pane, extracted from the CM6 lezer tree the
 * code view already parses for highlighting. A generic walker covers most
 * grammars: declaration-ish nodes become symbols, their first identifier-ish
 * child is the name. Per-language config is only needed when the heuristic
 * misses — adding a language is a mapping entry, not a parser.
 */

export type CodeSymbolKind = "function" | "method" | "class" | "type" | "enum";

export interface CodeSymbol {
  name: string;
  kind: CodeSymbolKind;
  /** 0-based line of the declaration. */
  line: number;
  /** Nesting depth (methods inside a class are depth 1). */
  depth: number;
}

// Node-name → symbol kind. Covers the lezer grammars behind ts/js/python/go/
// rust/java/cpp and friends; names not listed fall through the kind patterns.
const KIND_BY_PATTERN: Array<[RegExp, CodeSymbolKind]> = [
  [/Method(Declaration|Definition|Decl)$/, "method"],
  [/Function(Declaration|Definition|Decl)$/, "function"],
  [/Class(Declaration|Definition|Decl)$/, "class"],
  [/(Struct|Interface|Trait|Impl)(Declaration|Definition|Decl|Item)$/, "type"],
  [/TypeAlias(Declaration|Definition)?$|TypeSpec$|TypeDecl$/, "type"],
  [/Enum(Declaration|Definition|Decl|Item)$/, "enum"],
  [/^(FunctionDecl|MethodDecl|FunctionItem)$/, "function"],
];

// Identifier-ish node names, in preference order, searched within a symbol
// node to recover its display name.
const NAME_NODE_PATTERN =
  /Definition$|^DefName$|^Identifier$|^VariableName$|^TypeIdentifier$|^FieldIdentifier$|^FieldName$|^PropertyName$|^Name$/;

const MAX_SYMBOLS = 500;

export function extractCodeSymbols(view: EditorView): CodeSymbol[] {
  const tree = syntaxTree(view.state);
  const doc = view.state.doc;
  const symbols: CodeSymbol[] = [];
  // Stack of symbol node end positions to compute nesting depth.
  const enclosing: number[] = [];

  tree.iterate({
    enter(node) {
      while (enclosing.length > 0 && node.from >= enclosing[enclosing.length - 1]) enclosing.pop();
      if (symbols.length >= MAX_SYMBOLS) return false;
      const kind = kindOf(node.name);
      if (!kind) return undefined;
      const name = findSymbolName(view, node.node);
      if (!name) return undefined;
      symbols.push({ name, kind, line: doc.lineAt(node.from).number - 1, depth: enclosing.length });
      enclosing.push(node.to);
      return undefined;
    },
  });
  return symbols;
}

function kindOf(nodeName: string): CodeSymbolKind | null {
  for (const [pattern, kind] of KIND_BY_PATTERN) {
    if (pattern.test(nodeName)) return kind;
  }
  return null;
}

// Bounded BFS: direct children first, then grandchildren (Go wraps the name
// in a spec node, C++ in a declarator). Nested symbol nodes are not entered —
// a method's name must not be claimed by its class.
function findSymbolName(view: EditorView, node: SyntaxNode): string | null {
  let level: SyntaxNode[] = childrenOf(node);
  for (let depth = 0; depth < 2; depth++) {
    const next: SyntaxNode[] = [];
    for (const child of level) {
      if (NAME_NODE_PATTERN.test(child.type.name)) return view.state.sliceDoc(child.from, child.to);
      if (!kindOf(child.type.name)) next.push(...childrenOf(child));
    }
    level = next;
  }
  return null;
}

function childrenOf(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) children.push(child);
  return children;
}
