export interface ScenarioStep {
  id: string;
  title: string;
  description: string;
  modules: string[];
}

export interface RuntimeScenario {
  id: string;
  title: string;
  goal: string;
  steps: ScenarioStep[];
}

export class RuntimeScenarioCatalog {
  private scenarios = new Map<string, RuntimeScenario>();

  add(scenario: RuntimeScenario): void {
    this.scenarios.set(scenario.id, scenario);
  }

  get(id: string): RuntimeScenario | null {
    return this.scenarios.get(id) ?? null;
  }

  list(): readonly RuntimeScenario[] {
    return [...this.scenarios.values()];
  }
}
