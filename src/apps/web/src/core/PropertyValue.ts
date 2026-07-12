// Pure property value/type unions shared by the kernel (metadata frontmatter)
// and the app-side property widgets. Kept in core so vault/metadata can
// reference them without importing the App-flavored PropertyTypes module.
export type PropertyType =
  | "text"
  | "number"
  | "checkbox"
  | "date"
  | "datetime"
  | "tags"
  | "aliases"
  | "multitext"
  | "file"
  | "folder"
  | "property"
  | "unknown";

export type PropertyValue =
  | string
  | number
  | boolean
  | PropertyValue[]
  | { [key: string]: PropertyValue }
  | null;
