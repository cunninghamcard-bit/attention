import { Events } from "../core/Events";
import { coercePropertyValue } from "./Frontmatter";
import { renderAliasPropertyWidget } from "./AliasPropertyWidget";
import { renderMultiValuePropertyWidget } from "./MultiValuePropertyWidget";
import { renderPropertyLinkValue } from "./PropertyLinkRenderer";
import { bindPropertyLinkSuggest } from "./PropertyLinkSuggest";
import { renderTagPropertyWidget } from "./TagPropertyWidget";
import type {
  PropertyDefinition,
  PropertyType,
  PropertyTypeDefinition,
  PropertyTypeInfo,
  PropertyTypeWidget,
  PropertyValue,
} from "./PropertyTypes";

const DEFAULT_TYPES: PropertyTypeDefinition[] = [
  { type: "text", name: "Text", icon: "lucide-text", defaultValue: "" },
  { type: "number", name: "Number", icon: "lucide-binary", defaultValue: 0 },
  { type: "checkbox", name: "Checkbox", icon: "lucide-check-square", defaultValue: false },
  { type: "date", name: "Date", icon: "lucide-calendar", defaultValue: "" },
  { type: "datetime", name: "Date & time", icon: "lucide-clock", defaultValue: "" },
  { type: "tags", name: "Tags", icon: "lucide-tags", defaultValue: [] },
  { type: "aliases", name: "Aliases", icon: "lucide-forward", defaultValue: [] },
  { type: "multitext", name: "List", icon: "lucide-list", defaultValue: [] },
  { type: "file", name: "File", icon: "lucide-file", defaultValue: "" },
  { type: "folder", name: "Folder", icon: "lucide-folder", defaultValue: "" },
  { type: "property", name: "Property", icon: "lucide-info", defaultValue: "" },
  { type: "unknown", name: "Unknown", icon: "lucide-file-question", defaultValue: null },
];

export interface AssignedPropertyWidget {
  name: string;
  widget: PropertyType;
}

export class PropertyRegistry<TPropertyInfo = PropertyDefinition, TAllProperties = readonly PropertyDefinition[]> extends Events {
  protected definitions = new Map<string, PropertyDefinition>();
  protected types = new Map<PropertyType, PropertyTypeDefinition>();
  protected widgets = new Map<PropertyType, PropertyTypeWidget>();
  readonly assignedWidgets = new Map<string, AssignedPropertyWidget>();

  constructor() {
    super();
    for (const type of DEFAULT_TYPES) this.registerType(type);
    this.registerDefaultWidgets();
    this.register({ id: "tags", name: "tags", type: "tags", icon: "lucide-tags" });
    this.register({ id: "aliases", name: "aliases", type: "aliases", icon: "lucide-at-sign" });
    this.register({ id: "cssclasses", name: "cssclasses", type: "multitext", icon: "lucide-palette" });
  }

  register(definition: PropertyDefinition): void {
    const id = normalizePropertyId(definition.id);
    if (!id) return;
    const name = definition.name || id;
    const type = this.types.has(definition.type) ? definition.type : "text";
    this.assignedWidgets.set(id, { name, widget: type });
    this.definitions.set(id, {
      ...definition,
      id,
      name,
      type,
    });
  }

  unregister(id: string): void {
    const normalized = normalizePropertyId(id);
    this.definitions.delete(normalized);
    if (!isReservedProperty(normalized)) this.assignedWidgets.delete(normalized);
  }

  get(id: string): PropertyDefinition | null {
    return this.definitions.get(normalizePropertyId(id)) ?? null;
  }

  ensureDefinition(id: string, value: PropertyValue = null): PropertyDefinition {
    const normalized = normalizePropertyId(id);
    const existing = this.get(normalized);
    const assignedType = this.getAssignedWidget(normalized);
    const inferredType = this.inferType(normalized, value);
    const type = assignedType ?? inferredType;
    if (existing && existing.type === type) return existing;
    const definition: PropertyDefinition = {
      id: normalized,
      name: normalized,
      type,
      icon: this.getType(type)?.icon,
    };
    this.definitions.set(normalized, definition);
    return definition;
  }

  setPropertyType(id: string, type: PropertyType): void {
    const definition = this.ensureDefinition(id);
    this.register({ ...definition, type, icon: this.getType(type)?.icon ?? definition.icon });
  }

  setType(id: string, type: PropertyType): void {
    this.setPropertyType(id, type);
  }

  unsetType(id: string): void {
    const normalized = normalizePropertyId(id);
    if (isReservedProperty(normalized)) return;
    this.assignedWidgets.delete(normalized);
    const definition = this.definitions.get(normalized);
    if (definition) this.definitions.set(normalized, { ...definition, type: "text", icon: this.getType("text")?.icon });
  }

  getAssignedWidget(id: string): PropertyType | null {
    const normalized = normalizePropertyId(id);
    if (normalized === "aliases") return "aliases";
    if (normalized === "tags") return "tags";
    if (normalized === "cssclasses") return "multitext";
    return this.assignedWidgets.get(normalized)?.widget ?? null;
  }

  registerType(definition: PropertyTypeDefinition): void {
    this.types.set(definition.type, definition);
  }

  getType(type: PropertyType): PropertyTypeDefinition | null {
    return this.types.get(type) ?? null;
  }

  getTypeInfo(type: PropertyType): PropertyTypeDefinition | null {
    return this.getType(type);
  }

  getPropertyTypeInfo(id: string, value: PropertyValue = null): PropertyTypeInfo {
    const assignedType = this.getAssignedWidget(id);
    const assigned = assignedType ? this.getType(assignedType) : null;
    if (assigned && (value == null || this.validateValue(assigned.type, value))) {
      return { expected: assigned, inferred: assigned };
    }

    const inferredType = value == null ? assignedType ?? this.inferType(id, value) : this.inferType(id, value);
    const inferred = this.getType(inferredType) ?? this.getRequiredType("unknown");
    return { expected: assigned ?? inferred, inferred };
  }

  getPropertyInfo(id: string): TPropertyInfo | null {
    return this.get(id) as TPropertyInfo | null;
  }

  listTypes(): readonly PropertyTypeDefinition[] {
    return [...this.types.values()];
  }

  registerTypeWidget(type: PropertyType, widget: PropertyTypeWidget): void {
    this.widgets.set(type, widget);
  }

  getTypeWidget(type: PropertyType): PropertyTypeWidget | null {
    return this.widgets.get(type) ?? null;
  }

  getWidget(type: PropertyType): PropertyTypeWidget | null {
    return this.getTypeWidget(type);
  }

  normalizeValue(type: PropertyType, value: unknown): PropertyValue {
    return coercePropertyValue(type, value);
  }

  validateValue(type: PropertyType, value: PropertyValue): boolean {
    switch (type) {
      case "text":
      case "file":
      case "folder":
      case "property":
        return typeof value === "string";
      case "number":
        return typeof value === "number";
      case "checkbox":
        return typeof value === "boolean";
      case "date":
        return !value || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));
      case "datetime":
        return !value || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value));
      case "tags":
      case "aliases":
      case "multitext":
        return typeof value === "string" || Array.isArray(value);
      case "unknown":
        return true;
    }
  }

  inferType(id: string, value: PropertyValue = null): PropertyType {
    const normalized = normalizePropertyId(id);
    if (normalized === "tags") return "tags";
    if (normalized === "aliases") return "aliases";
    if (Array.isArray(value)) return "multitext";
    if (typeof value === "number") return "number";
    if (typeof value === "boolean") return "checkbox";
    if (typeof value === "string") {
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return "datetime";
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date";
    }
    if (typeof value === "string" || value == null) return "text";
    return "unknown";
  }

  list(): readonly PropertyDefinition[] {
    return [...this.definitions.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  getAllProperties(): TAllProperties {
    return this.list() as TAllProperties;
  }

  private getRequiredType(type: PropertyType): PropertyTypeDefinition {
    const definition = this.getType(type);
    if (!definition) throw new Error(`Missing property type: ${type}`);
    return definition;
  }

  private registerDefaultWidgets(): void {
    this.registerTypeWidget("text", inputWidget("text"));
    this.registerTypeWidget("number", inputWidget("number"));
    this.registerTypeWidget("date", inputWidget("date"));
    this.registerTypeWidget("datetime", inputWidget("datetime-local"));
    this.registerTypeWidget("file", inputWidget("text", true));
    this.registerTypeWidget("folder", inputWidget("text", true));
    this.registerTypeWidget("property", inputWidget("text", true));
    this.registerTypeWidget("checkbox", {
      render(parent, context) {
        const inputEl = document.createElement("input");
        inputEl.type = "checkbox";
        inputEl.className = "metadata-input-checkbox";
        inputEl.checked = context.value === true;
        inputEl.addEventListener("change", () => context.onChange(inputEl.checked));
        parent.appendChild(inputEl);
      },
    });
    const listWidget = {
      render(parent: HTMLElement, context: Parameters<PropertyTypeWidget["render"]>[1]) {
        renderMultiValuePropertyWidget(parent, context);
      },
    };
    this.registerTypeWidget("tags", {
      render(parent, context) {
        renderTagPropertyWidget(parent, context);
      },
    });
    this.registerTypeWidget("aliases", {
      render(parent, context) {
        renderAliasPropertyWidget(parent, context);
      },
    });
    this.registerTypeWidget("multitext", listWidget);
    this.registerTypeWidget("unknown", {
      render(parent, context) {
        const valueEl = document.createElement("div");
        valueEl.className = "metadata-property-value-item mod-unknown";
        valueEl.textContent = JSON.stringify(context.value);
        parent.appendChild(valueEl);
      },
    });
  }
}

function inputWidget(type: HTMLInputElement["type"], linkSuggest = type === "text"): PropertyTypeWidget {
  return {
    render(parent, context) {
      const showInput = () => {
        parent.replaceChildren();
        const inputEl = document.createElement("input");
        inputEl.type = type;
        inputEl.className = "metadata-input-text";
        inputEl.value = String(context.value ?? "");
        if (linkSuggest) bindPropertyLinkSuggest(inputEl, context);
        inputEl.addEventListener("change", () => {
          if (type === "number") context.onChange(inputEl.value === "" ? null : Number(inputEl.value));
          else context.onChange(inputEl.value || null);
        });
        parent.appendChild(inputEl);
        return inputEl;
      };
      if (type === "text" && renderPropertyLinkValue(String(context.value ?? ""), parent, context, {
        onEdit: () => {
          const inputEl = showInput();
          inputEl.focus();
          inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
        },
      })) return;
      const inputEl = document.createElement("input");
      inputEl.type = type;
      inputEl.className = "metadata-input-text";
      inputEl.value = String(context.value ?? "");
      if (linkSuggest) bindPropertyLinkSuggest(inputEl, context);
      inputEl.addEventListener("change", () => {
        if (type === "number") context.onChange(inputEl.value === "" ? null : Number(inputEl.value));
        else context.onChange(inputEl.value || null);
      });
      parent.appendChild(inputEl);
    },
  };
}

function normalizePropertyId(id: string): string {
  return id.trim();
}

function isReservedProperty(id: string): boolean {
  return id === "aliases" || id === "tags" || id === "cssclasses";
}
