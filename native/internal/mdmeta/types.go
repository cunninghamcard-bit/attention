package mdmeta

// Metadata is a note's parsed markdown metadata.
// It ports CachedMetadata from apps/web/metadata/MetadataCache.ts.
type Metadata struct {
	Frontmatter         map[string]any    `json:"frontmatter,omitempty"`
	FrontmatterPosition *Pos              `json:"frontmatterPosition,omitempty"`
	FrontmatterLinks    []FrontmatterLink `json:"frontmatterLinks,omitempty"`
	Sections            []Section         `json:"sections,omitempty"`
	Headings            []Heading         `json:"headings"`
	Blocks              map[string]Block  `json:"blocks,omitempty"`
	ListItems           []ListItem        `json:"listItems,omitempty"`
	Links               []Link            `json:"links"`
	Embeds              []Link            `json:"embeds"`
	ReferenceLinks      []ReferenceLink   `json:"referenceLinks"`
	Footnotes           []Footnote        `json:"footnotes"`
	FootnoteRefs        []Footnote        `json:"footnoteRefs"`
	Tags                []Tag             `json:"tags"`
	// URLs are the http(s) addresses it names (urls.go), the reader's own.
	URLs []Link `json:"urls,omitempty"`
}

// Loc is a line/column/offset cursor.
// It ports Loc from apps/web/metadata/MetadataCache.ts.
type Loc struct {
	Line   int `json:"line"`
	Col    int `json:"col"`
	Offset int `json:"offset"`
}

// Pos is a start/end range. Heading positions also set Line.
// It ports Pos / SourceRangePosition from apps/web/metadata/MetadataCache.ts.
type Pos struct {
	Start Loc  `json:"start"`
	End   Loc  `json:"end"`
	Line  *int `json:"line,omitempty"`
}

// SourceMatch is the line-local span of a match.
// It ports SourceMatchPosition from apps/web/metadata/MetadataCache.ts.
type SourceMatch struct {
	Line  int    `json:"line"`
	Start int    `json:"start"`
	End   int    `json:"end"`
	Text  string `json:"text"`
}

// Heading is an ATX heading.
// It ports HeadingCache from apps/web/metadata/MetadataCache.ts.
type Heading struct {
	Heading  string `json:"heading"`
	Level    int    `json:"level"`
	Position Pos    `json:"position"`
}

// Section is a root markdown block (yaml, heading, paragraph, …).
// It ports SectionCache from apps/web/metadata/MetadataCache.ts.
type Section struct {
	ID       string `json:"id,omitempty"`
	Type     string `json:"type"`
	Position Pos    `json:"position"`
}

// Block is an identified ^block-id region.
// It ports BlockCache from apps/web/metadata/MetadataCache.ts.
type Block struct {
	ID       string `json:"id"`
	Position Pos    `json:"position"`
}

// ListItem is a list item with its parent line (negative for a list root).
// It ports ListItemCache from apps/web/metadata/MetadataCache.ts.
type ListItem struct {
	ID       string `json:"id,omitempty"`
	Task     string `json:"task,omitempty"`
	Parent   int    `json:"parent"`
	Position Pos    `json:"position"`
}

// Link is a wiki or markdown link or embed.
// It ports LinkCache / EmbedCache from apps/web/metadata/MetadataCache.ts.
type Link struct {
	Link        string      `json:"link"`
	Original    string      `json:"original"`
	DisplayText string      `json:"displayText,omitempty"`
	Position    Pos         `json:"position"`
	Source      SourceMatch `json:"source"`
}

// FrontmatterLink is a wiki link inside a frontmatter value.
// It ports FrontmatterLinkCache from apps/web/metadata/MetadataCache.ts.
type FrontmatterLink struct {
	Key         string `json:"key"`
	Link        string `json:"link"`
	Original    string `json:"original"`
	DisplayText string `json:"displayText,omitempty"`
}

// ReferenceLink is a `[id]: url` definition.
// It ports ReferenceLinkCache from apps/web/metadata/MetadataCache.ts.
type ReferenceLink struct {
	ID       string      `json:"id"`
	Link     string      `json:"link"`
	Position Pos         `json:"position"`
	Source   SourceMatch `json:"source"`
}

// Footnote is a `[^id]:` definition or `[^id]` reference.
// It ports FootnoteCache / FootnoteRefCache from apps/web/metadata/MetadataCache.ts.
type Footnote struct {
	ID       string `json:"id"`
	Position Pos    `json:"position"`
}

// Tag is an inline #tag.
// It ports TagCache from apps/web/metadata/MetadataCache.ts.
type Tag struct {
	Tag      string      `json:"tag"`
	Position Pos         `json:"position"`
	Source   SourceMatch `json:"source"`
}

// SourceBlock is one paragraph, heading or list item from ParseBlocks.
// It ports BlockCacheBlock from apps/web/metadata/BlockCache.ts.
type SourceBlock struct {
	Display string
	Node    SourceNode
}

// SourceNode is the typed node of a SourceBlock.
// It ports BlockCacheNode from apps/web/metadata/BlockCache.ts.
type SourceNode struct {
	Type     string // paragraph, heading, listItem
	ID       string
	Depth    int
	Position Pos
	Children []SourceChild
}

// SourceChild is a nested paragraph or list under a list item.
// It ports BlockCacheNode.children from apps/web/metadata/BlockCache.ts.
type SourceChild struct {
	Type     string
	Position Pos
}

// Linktext is a wiki-link path with an optional heading/block subpath.
// It ports ParsedLinktext from apps/web/metadata/Linkpath.ts.
type Linktext struct {
	Path    string `json:"path"`
	Subpath string `json:"subpath,omitempty"`
}

// SplitPath is a linkpath split on the first '#'.
// It ports SplitLinkpath from apps/web/metadata/Linkpath.ts.
type SplitPath struct {
	Path    string `json:"path"`
	Subpath string `json:"subpath"`
}

// ParsedFrontmatter is the YAML-subset parse of a note's leading --- block.
// It ports ParsedFrontmatter from apps/web/metadata/Frontmatter.ts.
type ParsedFrontmatter struct {
	HasFrontmatter bool
	Valid          bool
	Error          string
	Values         map[string]any
	Body           string
	Raw            string
	keys           []string
}

// WordCount is a word and character count.
// It ports WordCountResult from apps/web/builtin/WordCount.ts.
type WordCount struct {
	Words      int
	Characters int
}
