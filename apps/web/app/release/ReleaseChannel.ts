/**
 * Input: None
 * Output: ReleaseChannel, releaseChannels
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

export interface ReleaseChannel {
  id: "stable" | "insider" | "dev";
  name: string;
  allowPrerelease: boolean;
}

export const releaseChannels: ReleaseChannel[] = [
  { id: "stable", name: "Stable", allowPrerelease: false },
  { id: "insider", name: "Insider", allowPrerelease: true },
  { id: "dev", name: "Development", allowPrerelease: true },
];
