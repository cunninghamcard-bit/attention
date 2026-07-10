// Shared helpers for the CLI command batches (core + internal-plugin lanes).
// File resolution lives on the Cli class itself (`cli.tryResolveFile`), the
// real home.

export function tabbed(rows: Record<string, string>): string {
  return Object.entries(rows)
    .map(([key, value]) => `${key}\t${value}`)
    .join("\n");
}
