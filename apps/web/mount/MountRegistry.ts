/**
 * Input: None
 * Output: MountRecord, mountRegistry, HOME_MOUNT_NAME
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * Which repositories are mounted in this workspace, remembered across
 * launches. Read BEFORE the App exists (boot builds the adapter from it),
 * so it lives in plain localStorage.
 *
 * Only repository mounts are recorded: Home is not a record, it is always
 * there — the one fixed in-memory root, present at every launch.
 */

export const HOME_MOUNT_NAME = "Home";

export interface MountRecord {
  /** Top-level name in the tree; derived from the folder's basename. */
  name: string;
  /** Absolute path on this machine. */
  path: string;
}

const KEY = "attention-mounts";

export const mountRegistry = {
  list(): MountRecord[] {
    try {
      const raw = globalThis.localStorage?.getItem(KEY);
      const parsed = raw ? (JSON.parse(raw) as MountRecord[]) : [];
      return Array.isArray(parsed) ? parsed.filter((record) => record.name && record.path) : [];
    } catch {
      return [];
    }
  },

  /** Adds a folder under a name unique in this workspace ("repo 2", …). */
  add(path: string): MountRecord {
    const records = mountRegistry.list();
    const record = { name: uniqueName(basename(path), records), path };
    localStorage.setItem(KEY, JSON.stringify([...records, record]));
    return record;
  },

  remove(name: string): void {
    const remaining = mountRegistry.list().filter((record) => record.name !== name);
    localStorage.setItem(KEY, JSON.stringify(remaining));
  },

  has(path: string): boolean {
    return mountRegistry.list().some((record) => record.path === path);
  },
};

function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const name = cut === -1 ? trimmed : trimmed.slice(cut + 1);
  // Mount names are one path segment by construction; a folder named with a
  // separator cannot happen, but an empty basename (a drive root) can.
  return name || "repo";
}

function uniqueName(candidate: string, records: MountRecord[]): string {
  if (candidate !== HOME_MOUNT_NAME && !records.some((record) => record.name === candidate))
    return candidate;
  let index = 2;
  while (records.some((record) => record.name === `${candidate} ${index}`)) index += 1;
  return `${candidate} ${index}`;
}
