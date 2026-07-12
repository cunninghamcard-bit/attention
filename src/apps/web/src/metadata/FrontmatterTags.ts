import type { CachedMetadata } from "./MetadataCache";

// Pure frontmatter tag/alias readers. They live in the kernel (metadata) rather
// than the api facade so MetadataCache and TagIndex can read tags without an
// upward import; core/ApiUtils re-exports them to keep the public surface intact.

export function parseFrontMatterEntry(frontmatter: unknown, key: string | RegExp): unknown | null {
  if (!frontmatter || typeof frontmatter !== "object") return null;
  const entries = Object.entries(frontmatter as Record<string, unknown>);
  const found =
    typeof key === "string"
      ? entries.find(([entryKey]) => entryKey === key)
      : entries.find(([entryKey]) => key.test(entryKey));
  return found ? found[1] : null;
}

export function parseFrontMatterStringArray(
  frontmatter: unknown,
  key: string | RegExp,
): string[] | null {
  const value = parseFrontMatterEntry(frontmatter, key);
  return coerceStringArray(value);
}

export function parseFrontMatterAliases(frontmatter: unknown): string[] | null {
  const aliases = parseFrontMatterStringArray(frontmatter, /^aliases$/i);
  return aliases ? aliases.filter(Boolean) : null;
}

export function parseFrontMatterTags(frontmatter: unknown): string[] | null {
  const tags = parseFrontMatterStringArray(frontmatter, /^tags$/i);
  if (!tags) return null;
  return tags
    .filter((tag) => tag.length > 0 && !tag.includes(" "))
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));
}

export function getAllTags(cache: CachedMetadata | null | undefined): string[] | null {
  if (!cache) return null;
  const tags: string[] = [];
  for (const tag of parseFrontMatterTags(cache.frontmatter) ?? []) tags.push(tag);
  for (const entry of cache.tags ?? []) tags.push(entry.tag);
  return tags;
}

function coerceStringArray(value: unknown): string[] | null {
  if (!value) return null;
  if (typeof value === "string") return [value.trim()];
  if (Array.isArray(value))
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim());
  return null;
}
