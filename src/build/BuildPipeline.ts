import type { BuildArtifact, BuildTarget } from "./BuildTarget";

export interface BuildStep {
  id: string;
  label: string;
  run(target: BuildTarget): Promise<void> | void;
}

export class BuildPipeline {
  private steps: BuildStep[] = [];

  addStep(step: BuildStep): void {
    this.steps.push(step);
  }

  async run(target: BuildTarget): Promise<BuildArtifact> {
    for (const step of this.steps) await step.run(target);
    return {
      target,
      fileName: `obsidian-${target.platform}-${target.architecture}-${target.channel}.zip`,
    };
  }

  listSteps(): readonly BuildStep[] {
    return [...this.steps];
  }
}
