package mdmeta

import (
	"regexp"
	"strings"
)

var (
	blockHeadingRe    = regexp.MustCompile(`^(#{1,6})\s+(.+)$`)
	blockListRe       = regexp.MustCompile(`^(\s*)[-*+]\s+(.+)$`)
	blockHeadingStart = regexp.MustCompile(`^(#{1,6})\s+`)
	blockListStart    = regexp.MustCompile(`^(\s*)[-*+]\s+`)
	standaloneBlockRe = regexp.MustCompile(`^\^([a-zA-Z0-9-]+)\s*$`)
	trailingBlockIDRe = regexp.MustCompile(`(?:^|\s)\^([a-zA-Z0-9-]+)\s*$`)
)

type blockLine struct {
	text   string
	line   int
	offset int
}

// ParseBlocks walks paragraphs, headings and list items, attaching ^block-ids.
// It ports parseMarkdownBlocks from apps/web/metadata/BlockCache.ts.
func ParseBlocks(content string) []SourceBlock {
	lines := splitBlockLines(content)
	var blocks []SourceBlock
	index := frontmatterEndLine(lines)
	for index < len(lines) {
		line := lines[index]
		if strings.TrimSpace(line.text) == "" {
			index++
			continue
		}
		if id := parseStandaloneBlockID(line.text); id != "" {
			if len(blocks) > 0 {
				blocks[len(blocks)-1].Node.ID = id
			}
			index++
			continue
		}
		if heading := blockHeadingRe.FindStringSubmatch(line.text); heading != nil {
			text, id := stripTrailingBlockID(heading[2])
			display := strings.TrimSpace(heading[1] + " " + strings.TrimSpace(text))
			if display != "" {
				blocks = append(blocks, SourceBlock{
					Display: display,
					Node: SourceNode{
						Type:     "heading",
						ID:       id,
						Depth:    len(heading[1]),
						Position: linePosition(line, line),
					},
				})
			}
			index++
			continue
		}
		if listItem := blockListRe.FindStringSubmatch(line.text); listItem != nil {
			text, id := stripTrailingBlockID(listItem[2])
			display := strings.TrimSpace(text)
			nested := nextNestedList(lines, index, len(listItem[1]))
			lineEnd := nestedListEnd(lines, index)
			if nested != nil {
				lineEnd = line
			}
			if display != "" {
				node := SourceNode{
					Type:     "listItem",
					ID:       id,
					Depth:    len(listItem[1]),
					Position: linePosition(line, lineEnd),
				}
				if nested != nil {
					node.Children = []SourceChild{
						{Type: "paragraph", Position: linePosition(line, line)},
						{Type: "list", Position: linePosition(nested.start, nested.end)},
					}
				}
				blocks = append(blocks, SourceBlock{Display: display, Node: node})
			}
			index++
			continue
		}
		start := index
		var paragraphLines []blockLine
		for index < len(lines) && strings.TrimSpace(lines[index].text) != "" {
			if index != start && (blockHeadingStart.MatchString(lines[index].text) || blockListStart.MatchString(lines[index].text)) {
				break
			}
			if parseStandaloneBlockID(lines[index].text) != "" {
				break
			}
			paragraphLines = append(paragraphLines, lines[index])
			index++
		}
		rawParts := make([]string, len(paragraphLines))
		for i, item := range paragraphLines {
			rawParts[i] = item.text
		}
		text, id := stripTrailingBlockID(strings.Join(rawParts, "\n"))
		display := strings.TrimSpace(text)
		end := lines[start]
		if len(paragraphLines) > 0 {
			end = paragraphLines[len(paragraphLines)-1]
		}
		if display != "" {
			blocks = append(blocks, SourceBlock{
				Display: display,
				Node: SourceNode{
					Type:     "paragraph",
					ID:       id,
					Position: linePosition(lines[start], end),
				},
			})
		}
	}
	return blocks
}

func splitBlockLines(content string) []blockLine {
	raw := strings.Split(content, "\n")
	out := make([]blockLine, len(raw))
	offset := 0
	for i, line := range raw {
		text := strings.TrimSuffix(line, "\r")
		out[i] = blockLine{text: text, line: i, offset: offset}
		offset += len(line) + 1
	}
	return out
}

func frontmatterEndLine(lines []blockLine) int {
	if len(lines) == 0 || strings.TrimSpace(lines[0].text) != "---" {
		return 0
	}
	for index := 1; index < len(lines); index++ {
		if strings.TrimSpace(lines[index].text) == "---" {
			return index + 1
		}
	}
	return 0
}

func parseStandaloneBlockID(text string) string {
	m := standaloneBlockRe.FindStringSubmatch(strings.TrimSpace(text))
	if m == nil {
		return ""
	}
	return m[1]
}

func stripTrailingBlockID(text string) (string, string) {
	m := trailingBlockIDRe.FindStringSubmatch(text)
	if m == nil {
		return text, ""
	}
	loc := trailingBlockIDRe.FindStringSubmatchIndex(text)
	return strings.TrimRight(text[:loc[0]], " \t\n\r"), m[1]
}

type nestedList struct {
	start, end blockLine
}

func nextNestedList(lines []blockLine, index, indent int) *nestedList {
	var nested []blockLine
	for cursor := index + 1; cursor < len(lines); cursor++ {
		text := lines[cursor].text
		if strings.TrimSpace(text) == "" {
			break
		}
		match := blockListStart.FindStringSubmatch(text)
		if match == nil {
			break
		}
		if len(match[1]) <= indent {
			break
		}
		nested = append(nested, lines[cursor])
	}
	if len(nested) == 0 {
		return nil
	}
	return &nestedList{start: nested[0], end: nested[len(nested)-1]}
}

func nestedListEnd(lines []blockLine, index int) blockLine {
	end := lines[index]
	for cursor := index + 1; cursor < len(lines); cursor++ {
		text := lines[cursor].text
		if strings.TrimSpace(text) == "" {
			break
		}
		if blockListStart.MatchString(text) {
			end = lines[cursor]
		} else {
			break
		}
	}
	return end
}

func linePosition(start, end blockLine) Pos {
	return Pos{
		Start: Loc{Line: start.line, Col: 0, Offset: start.offset},
		End:   Loc{Line: end.line, Col: len(end.text), Offset: end.offset + len(end.text)},
	}
}
