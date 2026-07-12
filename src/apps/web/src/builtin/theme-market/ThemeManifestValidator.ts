import type { ThemeManifest } from "./ThemeManifest";

export interface ThemeManifestValidationIssue {
  field: string;
  message: string;
  severity: "error" | "warning";
}

export class ThemeManifestValidator {
  validate(manifest: Partial<ThemeManifest>): ThemeManifestValidationIssue[] {
    const issues: ThemeManifestValidationIssue[] = [];
    if (!manifest.id)
      issues.push({ field: "id", message: "Theme id is required.", severity: "error" });
    if (!manifest.name)
      issues.push({ field: "name", message: "Theme name is required.", severity: "error" });
    if (!manifest.version)
      issues.push({ field: "version", message: "Theme version is required.", severity: "error" });
    if (!manifest.modes?.length)
      issues.push({
        field: "modes",
        message: "Theme should declare light/dark support.",
        severity: "warning",
      });
    return issues;
  }
}
