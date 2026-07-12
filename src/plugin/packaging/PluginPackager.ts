import type { PluginPackage } from "../PluginManifest";
import { PluginManifestValidator } from "../PluginManifestValidator";

export interface PackagedPluginArtifact {
  id: string;
  files: Record<string, string>;
  warnings: string[];
}

export class PluginPackager {
  readonly validator = new PluginManifestValidator();

  packagePlugin(pkg: PluginPackage, mainJs = "", stylesCss = ""): PackagedPluginArtifact {
    const validation = this.validator.validate(pkg.manifest);
    if (!validation.valid) throw new Error(validation.issues.map((issue) => `${issue.field}: ${issue.message}`).join("\n"));
    return {
      id: pkg.manifest.id,
      warnings: validation.issues.filter((issue) => issue.severity === "warning").map((issue) => issue.message),
      files: {
        "manifest.json": JSON.stringify(pkg.manifest, null, 2),
        [pkg.entry || "main.js"]: mainJs,
        ...(stylesCss ? { "styles.css": stylesCss } : {}),
      },
    };
  }
}
