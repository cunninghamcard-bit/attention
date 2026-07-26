/**
 * Input: None
 * Output: BuildPlatform, BuildArchitecture, BuildTarget, BuildArtifact
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

export type BuildPlatform = "mac" | "windows" | "linux" | "mobile" | "web";
export type BuildArchitecture = "x64" | "arm64" | "universal";

export interface BuildTarget {
  platform: BuildPlatform;
  architecture: BuildArchitecture;
  channel: "stable" | "insider" | "dev";
}

export interface BuildArtifact {
  target: BuildTarget;
  fileName: string;
  sizeBytes?: number;
  checksum?: string;
}
