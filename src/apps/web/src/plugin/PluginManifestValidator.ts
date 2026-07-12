import type { PluginManifestInput } from "./PluginManifest";

export interface ManifestValidationIssue {
  field: string;
  message: string;
  severity: "error" | "warning";
}

export interface ManifestValidationResult {
  valid: boolean;
  issues: ManifestValidationIssue[];
}

export class PluginManifestValidator {
  validate(manifest: Partial<PluginManifestInput>): ManifestValidationResult {
    const issues: ManifestValidationIssue[] = [];
    if (!manifest.id) issues.push({ field: "id", message: "Plugin id is required.", severity: "error" });
    if (!manifest.name) issues.push({ field: "name", message: "Plugin name is required.", severity: "error" });
    if (!manifest.version) issues.push({ field: "version", message: "Plugin version is required.", severity: "error" });
    if (manifest.id && !/^[a-z0-9_-]+$/.test(manifest.id)) {
      issues.push({ field: "id", message: "Plugin id should use lowercase letters, numbers, underscores or dashes.", severity: "warning" });
    }
    return { valid: !issues.some((issue) => issue.severity === "error"), issues };
  }
}
