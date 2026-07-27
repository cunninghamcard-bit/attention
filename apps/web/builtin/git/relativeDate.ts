/**
 * Input: None
 * Output: formatRelativeDate, formatCommitDate
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/** Compact relative date copied from codiff's history sidebar. */
export function formatRelativeDate(value: string | number, now = Date.now()): string {
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) return String(value);
  const seconds = Math.floor((now - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** The commit's own date, spelled out. A header has room for the real date;
 * "4d ago" is for a list row that has to fit a hundred of them. */
export function formatCommitDate(value: string | number): string {
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) return String(value);
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
