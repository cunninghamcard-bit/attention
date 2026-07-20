import type { JsonStore, JsonStoreWriteOptions } from "./JsonStore";

export class PluginDataStore {
  constructor(readonly store: JsonStore) {}

  /** `null` when the file is missing, `undefined` when it exists but will not parse. */
  load<T = unknown>(pluginDirOrId: string): Promise<T | null | undefined> {
    return this.store.read<T>(`${normalizePluginDataDir(pluginDirOrId)}/data.json`);
  }

  save<T = unknown>(
    pluginDirOrId: string,
    data: T,
    options?: JsonStoreWriteOptions,
  ): Promise<void> {
    return this.store.write(`${normalizePluginDataDir(pluginDirOrId)}/data.json`, data, options);
  }

  delete(pluginDirOrId: string): Promise<void> {
    return this.store.delete(`${normalizePluginDataDir(pluginDirOrId)}/data.json`);
  }
}

function normalizePluginDataDir(pluginDirOrId: string): string {
  return pluginDirOrId.includes("/") ? pluginDirOrId : `plugins/${pluginDirOrId}`;
}
