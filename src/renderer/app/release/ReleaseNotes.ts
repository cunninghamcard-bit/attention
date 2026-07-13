export interface ReleaseNoteSection {
  title: string;
  items: string[];
}

export class ReleaseNotesBuilder {
  private sections: ReleaseNoteSection[] = [];

  addSection(title: string, items: string[]): void {
    this.sections.push({ title, items });
  }

  renderMarkdown(version: string): string {
    const lines = [`# Release ${version}`, ""];
    for (const section of this.sections) {
      lines.push(`## ${section.title}`, "");
      for (const item of section.items) lines.push(`- ${item}`);
      lines.push("");
    }
    return lines.join("\n");
  }
}
