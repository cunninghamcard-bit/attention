import type { ThemePackage } from "../../builtin/theme-market/ThemeManifest";
import { ThemeManifestValidator } from "../../builtin/theme-market/ThemeManifestValidator";

export interface PackagedThemeArtifact {
  id: string;
  files: Record<string, string>;
  warnings: string[];
}

export class ThemePackager {
  readonly validator = new ThemeManifestValidator();

  packageTheme(pkg: ThemePackage): PackagedThemeArtifact {
    const issues = this.validator.validate(pkg.manifest);
    const errors = issues.filter((issue) => issue.severity === "error");
    if (errors.length) throw new Error(errors.map((issue) => `${issue.field}: ${issue.message}`).join("\n"));
    return {
      id: pkg.manifest.id,
      warnings: issues.filter((issue) => issue.severity === "warning").map((issue) => issue.message),
      files: {
        "manifest.json": JSON.stringify(pkg.manifest, null, 2),
        [pkg.manifest.cssFile ?? "theme.css"]: pkg.cssText,
      },
    };
  }
}
