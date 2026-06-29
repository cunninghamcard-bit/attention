import type { RuntimeScenario } from "./RuntimeScenario";

export class ScenarioMarkdownRenderer {
  render(scenario: RuntimeScenario): string {
    const lines = [`# ${scenario.title}`, "", scenario.goal, ""];
    for (const step of scenario.steps) {
      lines.push(`## ${step.title}`, "", step.description, "", "Modules:");
      for (const mod of step.modules) lines.push(`- \`${mod}\``);
      lines.push("");
    }
    return lines.join("\n");
  }
}
