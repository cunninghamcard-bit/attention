export interface SettingsSectionDefinition {
  id: string;
  name: string;
  order: number;
  description?: string;
}

export class SettingsSectionRegistry {
  private sections = new Map<string, SettingsSectionDefinition>();

  register(section: SettingsSectionDefinition): void {
    this.sections.set(section.id, section);
  }

  unregister(id: string): void {
    this.sections.delete(id);
  }

  list(): readonly SettingsSectionDefinition[] {
    return [...this.sections.values()].sort((a, b) => a.order - b.order);
  }
}
