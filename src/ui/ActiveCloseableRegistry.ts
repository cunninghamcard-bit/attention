export interface ActiveCloseable {
  close(): void;
}

const activeCloseables: ActiveCloseable[] = [];

export function getActiveCloseables(): readonly ActiveCloseable[] {
  return activeCloseables;
}

export function registerActiveCloseable(closeable: ActiveCloseable): void {
  unregisterActiveCloseable(closeable);
  activeCloseables.push(closeable);
}

export function unregisterActiveCloseable(closeable: ActiveCloseable): void {
  const index = activeCloseables.indexOf(closeable);
  if (index !== -1) activeCloseables.splice(index, 1);
}

export function closeTopActiveCloseable(): boolean {
  const closeable = activeCloseables.at(-1);
  if (!closeable) return false;
  closeable.close();
  return true;
}
