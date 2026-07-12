import type { BuildArtifact } from "./BuildTarget";
import type { ReleaseChannel } from "./ReleaseChannel";

export interface ReleaseRecord {
  version: string;
  channel: ReleaseChannel["id"];
  artifacts: BuildArtifact[];
  notes: string;
  createdAt: string;
}

export class ReleaseManager {
  private releases: ReleaseRecord[] = [];

  createRelease(version: string, channel: ReleaseChannel["id"], artifacts: BuildArtifact[], notes = ""): ReleaseRecord {
    const release = { version, channel, artifacts, notes, createdAt: new Date().toISOString() };
    this.releases.unshift(release);
    return release;
  }

  latest(channel?: ReleaseChannel["id"]): ReleaseRecord | null {
    return this.releases.find((release) => !channel || release.channel === channel) ?? null;
  }

  list(): readonly ReleaseRecord[] {
    return [...this.releases];
  }
}
