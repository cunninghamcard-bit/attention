// Package mdmeta is the pure markdown → metadata parse, ported from
// apps/web/metadata/MarkdownMetadataParser.ts and the helpers it uses
// (BlockCache.ts, Frontmatter.ts, FrontmatterTags.ts, Linkpath.ts,
// MetadataCache.ts types, and apps/web/builtin/WordCount.ts countWords).
//
// Positions use byte offsets into the UTF-8 source. The TypeScript
// originals count UTF-16 code units; they differ only for characters
// outside the Basic Multilingual Plane.
package mdmeta
