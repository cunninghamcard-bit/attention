package mdmeta

import (
	"math"
	"net/url"
	"regexp"
	"strings"
)

var (
	headingLineRe     = regexp.MustCompile(`^(#{1,6})\s+(.+)$`)
	wikiLinkRe        = regexp.MustCompile(`!?\[\[([^\]]+)\]\]`)
	mdLinkRe          = regexp.MustCompile(`!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)`)
	frontmatterWikiRe = regexp.MustCompile(`\[\[([^\]]+)\]\]`)
	refLinkRe         = regexp.MustCompile(`^[ \t]{0,3}\[([^\]\s]+)\]:[ \t]*(\S+)`)
	footnoteDefRe     = regexp.MustCompile(`(^|\n)([ \t]{0,3}\[\^([^\]\s]+)\]:[^\n]*(?:\n[ \t]+[^\n]*)*)`)
	footnoteRefRe     = regexp.MustCompile(`\[\^([^\]\s]+)\]`)
	tagRe             = regexp.MustCompile(`(^|[[:space:]])#([\p{L}\p{N}/_-]+)`)
	sectionCodeRe     = regexp.MustCompile("^(```|~~~)")
	sectionHeadingRe  = regexp.MustCompile(`^(#{1,6})\s+`)
	sectionCalloutRe  = regexp.MustCompile(`(?i)^>\s*\[![^\]]+\]`)
	sectionQuoteRe    = regexp.MustCompile(`^>\s?`)
	sectionListRe     = regexp.MustCompile(`^[ \t]*(?:[-*+]|\d+[.)])\s+`)
	sectionBreakRe    = regexp.MustCompile(`^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$`)
	sectionHTMLRe     = regexp.MustCompile(`^</?[A-Za-z][^>]*>`)
	sectionBlockIDRe  = regexp.MustCompile(`\s\^([A-Za-z0-9-]+)\s*$`)
	externalLinkRe    = regexp.MustCompile(`(?i)^[a-z][a-z0-9+.-]*:`)
)

// Parse is the pure markdown → metadata parse.
// It ports parseMarkdownMetadata from apps/web/metadata/MarkdownMetadataParser.ts.
func Parse(source string) Metadata {
	lines := splitCRLF(source)
	offsets := lineOffsets(source, lines)
	blockEntries := ParseBlocks(source)
	fences := fenceMask(lines)
	wikiLinks := collectWikiLinks(lines, offsets, fences)
	markdownLinks := collectMarkdownLinks(lines, offsets, fences)
	frontmatterPosition := getFrontmatterPosition(source)
	parsedFM := ParseFrontmatter(source)
	frontmatter := extractFrontmatter(parsedFM)
	contentRefs := make([]parsedRef, 0, len(wikiLinks)+len(markdownLinks))
	for _, match := range wikiLinks {
		if isContentReference(match.position, frontmatterPosition) {
			contentRefs = append(contentRefs, match)
		}
	}
	for _, match := range markdownLinks {
		if isContentReference(match.position, frontmatterPosition) {
			contentRefs = append(contentRefs, match)
		}
	}

	out := Metadata{
		Frontmatter:         frontmatter,
		FrontmatterPosition: frontmatterPosition,
		FrontmatterLinks:    collectFrontmatterLinks(frontmatter, parsedFM.keys),
		Sections:            collectSections(lines, offsets, frontmatterPosition),
		Blocks:              collectBlocks(blockEntries),
		ListItems:           collectListItems(blockEntries),
		Headings:            collectHeadings(lines, offsets),
		Links:               make([]Link, 0),
		Embeds:              make([]Link, 0),
		ReferenceLinks:      collectReferenceLinks(lines, offsets, fences),
		Footnotes:           collectFootnotes(source),
		FootnoteRefs:        collectFootnoteRefs(source),
		Tags:                collectTags(lines, offsets, fences, frontmatterPosition),
	}
	for _, match := range contentRefs {
		item := Link{
			Link:        normalizeLinkpath(match.link),
			Original:    match.original,
			DisplayText: match.displayText,
			Position:    match.position,
			Source:      match.source,
		}
		if match.embed {
			out.Embeds = append(out.Embeds, item)
		} else {
			out.Links = append(out.Links, item)
		}
	}
	return out
}

func normalizeLinkpath(linkpath string) string {
	return strings.TrimSpace(linkpath)
}

func extractFrontmatter(parsed ParsedFrontmatter) map[string]any {
	if len(parsed.Values) == 0 {
		return nil
	}
	return parsed.Values
}

func collectHeadings(lines []string, offsets []int) []Heading {
	headings := make([]Heading, 0)
	for index, line := range lines {
		match := headingLineRe.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		lineNo := index
		off := 0
		if index < len(offsets) {
			off = offsets[index]
		}
		headings = append(headings, Heading{
			Heading: match[2],
			Level:   len(match[1]),
			Position: Pos{
				Start: Loc{Line: index, Col: 0, Offset: off},
				End:   Loc{Line: index, Col: len(line), Offset: off + len(line)},
				Line:  &lineNo,
			},
		})
	}
	return headings
}

func collectTags(lines []string, offsets []int, fences []bool, frontmatterPosition *Pos) []Tag {
	tags := make([]Tag, 0)
	for lineNumber, line := range lines {
		if lineNumber < len(fences) && fences[lineNumber] {
			continue
		}
		locs := tagRe.FindAllStringSubmatchIndex(line, -1)
		for _, loc := range locs {
			start := loc[3] // end of prefix → '#'
			end := loc[5]   // end of tag body
			tag := line[start:end]
			pos := inlineRangeToPosition(offsets, lineNumber, start, end)
			if !isContentReference(pos, frontmatterPosition) {
				continue
			}
			tags = append(tags, Tag{
				Tag:      tag,
				Position: pos,
				Source: SourceMatch{
					Line:  lineNumber,
					Start: start,
					End:   end,
					Text:  line,
				},
			})
		}
	}
	return tags
}

type parsedRef struct {
	original    string
	link        string
	displayText string
	embed       bool
	position    Pos
	source      SourceMatch
}

func collectWikiLinks(lines []string, offsets []int, fences []bool) []parsedRef {
	var links []parsedRef
	for lineNumber, line := range lines {
		if lineNumber < len(fences) && fences[lineNumber] {
			continue
		}
		locs := wikiLinkRe.FindAllStringSubmatchIndex(line, -1)
		for _, loc := range locs {
			original := line[loc[0]:loc[1]]
			inner := line[loc[2]:loc[3]]
			info := parseWikiReference(inner)
			start, end := loc[0], loc[1]
			links = append(links, parsedRef{
				original:    original,
				link:        info.link,
				displayText: info.displayText,
				embed:       strings.HasPrefix(original, "!"),
				position:    inlineRangeToPosition(offsets, lineNumber, start, end),
				source: SourceMatch{
					Line:  lineNumber,
					Start: start,
					End:   end,
					Text:  line,
				},
			})
		}
	}
	return links
}

func collectMarkdownLinks(lines []string, offsets []int, fences []bool) []parsedRef {
	var links []parsedRef
	for lineNumber, line := range lines {
		if lineNumber < len(fences) && fences[lineNumber] {
			continue
		}
		locs := mdLinkRe.FindAllStringSubmatchIndex(line, -1)
		for _, loc := range locs {
			original := line[loc[0]:loc[1]]
			display := line[loc[2]:loc[3]]
			link := safeDecodeLinkpath(line[loc[4]:loc[5]])
			if isExternalLink(link) {
				continue
			}
			start, end := loc[0], loc[1]
			ref := parsedRef{
				original: original,
				link:     link,
				embed:    strings.HasPrefix(original, "!"),
				position: inlineRangeToPosition(offsets, lineNumber, start, end),
				source: SourceMatch{
					Line:  lineNumber,
					Start: start,
					End:   end,
					Text:  line,
				},
			}
			if display != "" {
				ref.displayText = display
			}
			links = append(links, ref)
		}
	}
	return links
}

func collectReferenceLinks(lines []string, offsets []int, fences []bool) []ReferenceLink {
	links := make([]ReferenceLink, 0)
	for lineNumber, line := range lines {
		if lineNumber < len(fences) && fences[lineNumber] {
			continue
		}
		match := refLinkRe.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		id := match[1]
		if strings.HasPrefix(id, "^") {
			continue
		}
		start := strings.Index(line, match[0])
		if start < 0 {
			start = 0
		}
		end := start + len(match[0])
		links = append(links, ReferenceLink{
			ID:       id,
			Link:     safeDecodeLinkpath(match[2]),
			Position: inlineRangeToPosition(offsets, lineNumber, start, end),
			Source: SourceMatch{
				Line:  lineNumber,
				Start: start,
				End:   end,
				Text:  line,
			},
		})
	}
	return links
}

func collectBlocks(blocks []SourceBlock) map[string]Block {
	result := map[string]Block{}
	for _, block := range blocks {
		id := block.Node.ID
		if id == "" {
			continue
		}
		result[id] = Block{ID: id, Position: block.Node.Position}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func collectListItems(blocks []SourceBlock) []ListItem {
	var result []ListItem
	var stack []struct {
		depth int
		line  int
	}
	rootParentLine := 0
	previousEndLine := math.MinInt
	for _, block := range blocks {
		node := block.Node
		if node.Type != "listItem" {
			continue
		}
		depth := node.Depth
		line := node.Position.Start.Line
		if depth == 0 && line > previousEndLine+1 {
			rootParentLine = line
		}
		for len(stack) > 0 && stack[len(stack)-1].depth >= depth {
			stack = stack[:len(stack)-1]
		}
		parent := -rootParentLine
		if len(stack) > 0 {
			parent = stack[len(stack)-1].line
		}
		item := ListItem{Parent: parent, Position: node.Position}
		if node.ID != "" {
			item.ID = node.ID
		}
		result = append(result, item)
		stack = append(stack, struct {
			depth int
			line  int
		}{depth, line})
		previousEndLine = node.Position.End.Line
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func collectSections(lines []string, offsets []int, frontmatterPosition *Pos) []Section {
	var sections []Section
	index := 0
	if frontmatterPosition != nil {
		sections = append(sections, Section{Type: "yaml", Position: *frontmatterPosition})
		index = frontmatterPosition.End.Line
		if index < 0 {
			index = 0
		}
	}
	for index < len(lines) {
		for index < len(lines) && strings.TrimSpace(lines[index]) == "" {
			index++
		}
		if index >= len(lines) {
			break
		}
		start := index
		line := lines[index]
		sectionType := getSectionType(line)
		switch sectionType {
		case "code":
			index = findCodeFenceEnd(lines, index) + 1
		case "heading", "thematicBreak", "html":
			index++
		case "list":
			index = collectUntilBlankOrRootBlock(lines, index+1, func(next string) bool {
				return getSectionType(next) == "list"
			})
		case "blockquote", "callout":
			index = collectUntilBlankOrRootBlock(lines, index+1, func(next string) bool {
				return sectionQuoteRe.MatchString(next)
			})
		case "table":
			index = collectUntilBlankOrRootBlock(lines, index+1, func(next string) bool {
				return strings.Contains(next, "|")
			})
		default:
			index = collectUntilBlankOrRootBlock(lines, index+1, func(string) bool { return false })
		}
		end := start
		if index-1 > start {
			end = index - 1
		}
		sec := Section{
			Type:     sectionType,
			Position: lineRangeToPosition(lines, offsets, start, end),
		}
		if id := findSectionBlockID(lines, start, end); id != "" {
			sec.ID = id
		}
		sections = append(sections, sec)
	}
	if len(sections) == 0 {
		return nil
	}
	return sections
}

func getFrontmatterPosition(source string) *Pos {
	loc := frontmatterRe.FindStringIndex(source)
	if loc == nil {
		return nil
	}
	end := loc[1]
	pos := Pos{
		Start: offsetToPos(source, 0),
		End:   offsetToPos(source, end),
	}
	return &pos
}

func getSectionType(line string) string {
	trimmed := strings.TrimSpace(line)
	if sectionCodeRe.MatchString(trimmed) {
		return "code"
	}
	if sectionHeadingRe.MatchString(line) {
		return "heading"
	}
	if sectionCalloutRe.MatchString(line) {
		return "callout"
	}
	if sectionQuoteRe.MatchString(line) {
		return "blockquote"
	}
	if sectionListRe.MatchString(line) {
		return "list"
	}
	if sectionBreakRe.MatchString(line) {
		return "thematicBreak"
	}
	if sectionHTMLRe.MatchString(trimmed) {
		return "html"
	}
	if strings.Contains(line, "|") {
		return "table"
	}
	return "paragraph"
}

func findCodeFenceEnd(lines []string, start int) int {
	marker := "```"
	if strings.HasPrefix(strings.TrimSpace(lines[start]), "~~~") {
		marker = "~~~"
	}
	for index := start + 1; index < len(lines); index++ {
		if strings.HasPrefix(strings.TrimSpace(lines[index]), marker) {
			return index
		}
	}
	return len(lines) - 1
}

func collectUntilBlankOrRootBlock(lines []string, index int, sameBlock func(string) bool) int {
	for index < len(lines) {
		line := lines[index]
		if strings.TrimSpace(line) == "" {
			break
		}
		if !sameBlock(line) && isRootSectionStart(line) {
			break
		}
		index++
	}
	return index
}

func isRootSectionStart(line string) bool {
	t := getSectionType(line)
	return t == "heading" || t == "code" || t == "thematicBreak" || t == "html" ||
		t == "blockquote" || t == "callout" || t == "list"
}

func findSectionBlockID(lines []string, start, end int) string {
	for index := start; index <= end && index < len(lines); index++ {
		m := sectionBlockIDRe.FindStringSubmatch(lines[index])
		if m != nil {
			return m[1]
		}
	}
	return ""
}

func lineRangeToPosition(lines []string, offsets []int, start, end int) Pos {
	startOff := 0
	if start < len(offsets) {
		startOff = offsets[start]
	}
	endOff := startOff
	endCol := 0
	if end < len(offsets) {
		endOff = offsets[end]
		if end < len(lines) {
			endOff += len(lines[end])
			endCol = len(lines[end])
		}
	}
	return Pos{
		Start: Loc{Line: start, Col: 0, Offset: startOff},
		End:   Loc{Line: end, Col: endCol, Offset: endOff},
	}
}

func collectFrontmatterLinks(frontmatter map[string]any, keys []string) []FrontmatterLink {
	if frontmatter == nil {
		return nil
	}
	var links []FrontmatterLink
	if len(keys) == 0 {
		for k, v := range frontmatter {
			collectFrontmatterLinksFromValue(k, v, &links)
		}
	} else {
		for _, k := range keys {
			collectFrontmatterLinksFromValue(k, frontmatter[k], &links)
		}
	}
	if len(links) == 0 {
		return nil
	}
	return links
}

func collectFrontmatterLinksFromValue(key string, value any, links *[]FrontmatterLink) {
	switch v := value.(type) {
	case string:
		locs := frontmatterWikiRe.FindAllStringSubmatchIndex(v, -1)
		for _, loc := range locs {
			parsed := parseWikiReference(v[loc[2]:loc[3]])
			item := FrontmatterLink{
				Key:      key,
				Link:     parsed.link,
				Original: v[loc[0]:loc[1]],
			}
			if parsed.displayText != "" {
				item.DisplayText = parsed.displayText
			}
			*links = append(*links, item)
		}
	case []any:
		for _, item := range v {
			collectFrontmatterLinksFromValue(key, item, links)
		}
	case []string:
		for _, item := range v {
			collectFrontmatterLinksFromValue(key, item, links)
		}
	}
}

type wikiRef struct {
	link        string
	displayText string
}

func parseWikiReference(value string) wikiRef {
	link, display, found := strings.Cut(value, "|")
	out := wikiRef{link: strings.TrimSpace(link)}
	if found {
		if t := strings.TrimSpace(display); t != "" {
			out.displayText = t
		}
	}
	return out
}

func inlineRangeToPosition(offsets []int, line, start, end int) Pos {
	lineOffset := 0
	if line < len(offsets) {
		lineOffset = offsets[line]
	}
	return Pos{
		Start: Loc{Line: line, Col: start, Offset: lineOffset + start},
		End:   Loc{Line: line, Col: end, Offset: lineOffset + end},
	}
}

func isContentReference(position Pos, frontmatterPosition *Pos) bool {
	return frontmatterPosition == nil || position.Start.Offset >= frontmatterPosition.End.Offset
}

func collectFootnotes(source string) []Footnote {
	footnotes := make([]Footnote, 0)
	locs := footnoteDefRe.FindAllStringSubmatchIndex(source, -1)
	for _, loc := range locs {
		id := source[loc[6]:loc[7]]
		if id == "" || loc[4] == loc[5] {
			continue
		}
		start := loc[4]
		end := loc[5]
		footnotes = append(footnotes, Footnote{
			ID: id,
			Position: Pos{
				Start: offsetToPos(source, start),
				End:   offsetToPos(source, end),
			},
		})
	}
	return footnotes
}

func collectFootnoteRefs(source string) []Footnote {
	refs := make([]Footnote, 0)
	locs := footnoteRefRe.FindAllStringSubmatchIndex(source, -1)
	for _, loc := range locs {
		id := source[loc[2]:loc[3]]
		if id == "" {
			continue
		}
		end := loc[1]
		if end < len(source) && source[end] == ':' {
			continue
		}
		start := loc[0]
		refs = append(refs, Footnote{
			ID: id,
			Position: Pos{
				Start: offsetToPos(source, start),
				End:   offsetToPos(source, end),
			},
		})
	}
	return refs
}

func offsetToPos(source string, offset int) Loc {
	if offset < 0 {
		offset = 0
	}
	if offset > len(source) {
		offset = len(source)
	}
	before := splitCRLF(source[:offset])
	last := ""
	if len(before) > 0 {
		last = before[len(before)-1]
	}
	return Loc{Line: len(before) - 1, Col: len(last), Offset: offset}
}

func safeDecodeLinkpath(linkpath string) string {
	decoded, err := url.PathUnescape(linkpath)
	if err != nil {
		return linkpath
	}
	return decoded
}

func isExternalLink(linkpath string) bool {
	return externalLinkRe.MatchString(linkpath) || strings.HasPrefix(linkpath, "#")
}

func lineOffsets(source string, lines []string) []int {
	offsets := make([]int, len(lines))
	offset := 0
	for i := range lines {
		offsets[i] = offset
		offset += len(lines[i])
		if offset < len(source) && source[offset] == '\r' {
			offset++
		}
		if offset < len(source) && source[offset] == '\n' {
			offset++
		}
	}
	return offsets
}

func splitCRLF(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); {
		if s[i] == '\r' && i+1 < len(s) && s[i+1] == '\n' {
			lines = append(lines, s[start:i])
			i += 2
			start = i
			continue
		}
		if s[i] == '\n' {
			lines = append(lines, s[start:i])
			i++
			start = i
			continue
		}
		i++
	}
	lines = append(lines, s[start:])
	return lines
}

// fenceMask marks fenced ``` / ~~~ lines so wiki links, markdown links,
// reference links and #tags inside them are not collected.
func fenceMask(lines []string) []bool {
	mask := make([]bool, len(lines))
	in := false
	marker := ""
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !in {
			switch {
			case strings.HasPrefix(trimmed, "~~~"):
				in, marker = true, "~~~"
				mask[i] = true
			case strings.HasPrefix(trimmed, "```"):
				in, marker = true, "```"
				mask[i] = true
			}
			continue
		}
		mask[i] = true
		if strings.HasPrefix(trimmed, marker) {
			in = false
		}
	}
	return mask
}
