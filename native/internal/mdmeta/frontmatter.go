package mdmeta

import (
	"regexp"
	"strconv"
	"strings"
)

// frontmatterRe ports FRONTMATTER_RE from apps/web/metadata/Frontmatter.ts.
var frontmatterRe = regexp.MustCompile(`(?s)^---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n)?`)

var (
	yamlKeyRe  = regexp.MustCompile(`^([^:#][^:]*):(?:\s*(.*))?$`)
	yamlListRe = regexp.MustCompile(`^\s*-\s*`)
	yamlItemRe = regexp.MustCompile(`^\s*-\s*(.*)$`)
	yamlIndent = regexp.MustCompile(`^\s+`)
	yamlNumber = regexp.MustCompile(`^-?\d+(?:\.\d+)?$`)
)

// ParseFrontmatter reads a leading YAML-subset --- block.
// It ports parseFrontmatter from apps/web/metadata/Frontmatter.ts.
func ParseFrontmatter(source string) ParsedFrontmatter {
	match := frontmatterRe.FindStringSubmatch(source)
	if match == nil {
		return ParsedFrontmatter{
			Valid:  true,
			Values: map[string]any{},
			Body:   source,
		}
	}
	raw := match[1]
	if err := validateYamlSubset(raw); err != "" {
		return ParsedFrontmatter{
			HasFrontmatter: true,
			Error:          err,
			Values:         map[string]any{},
			Body:           source[len(match[0]):],
			Raw:            raw,
		}
	}
	values, keys := parseYamlSubset(raw)
	return ParsedFrontmatter{
		HasFrontmatter: true,
		Valid:          true,
		Values:         values,
		Body:           source[len(match[0]):],
		Raw:            raw,
		keys:           keys,
	}
}

// GetFrontmatterValues is the YAML-subset mapping of a note's leading --- block.
// It ports getFrontmatterValues from apps/web/metadata/Frontmatter.ts.
func GetFrontmatterValues(source string) map[string]any {
	return ParseFrontmatter(source).Values
}

func validateYamlSubset(raw string) string {
	lines := splitCRLF(raw)
	index := 0
	for index < len(lines) {
		line := lines[index]
		index++
		if strings.TrimSpace(line) == "" || strings.HasPrefix(trimStart(line), "#") {
			continue
		}
		if len(line) > 0 && isSpace(line[0]) {
			return "Unexpected indentation in properties"
		}
		keyMatch := yamlKeyRe.FindStringSubmatch(line)
		if keyMatch == nil || strings.TrimSpace(keyMatch[1]) == "" {
			return "Invalid property line"
		}
		rest := ""
		if len(keyMatch) > 2 {
			rest = keyMatch[2]
		}
		if strings.TrimSpace(rest) != "" {
			continue
		}
		for index < len(lines) {
			if !yamlIndent.MatchString(lines[index]) {
				break
			}
			childLine := strings.TrimPrefix(lines[index], "  ")
			index++
			if strings.TrimSpace(childLine) == "" || strings.HasPrefix(trimStart(childLine), "#") {
				continue
			}
			if yamlListRe.MatchString(childLine) {
				continue
			}
			childKey := yamlKeyRe.FindStringSubmatch(childLine)
			if childKey == nil || strings.TrimSpace(childKey[1]) == "" {
				return "Invalid nested property line"
			}
		}
	}
	return ""
}

func parseYamlSubset(raw string) (map[string]any, []string) {
	values := map[string]any{}
	var keys []string
	lines := splitCRLF(raw)
	index := 0
	for index < len(lines) {
		line := lines[index]
		index++
		if strings.TrimSpace(line) == "" || strings.HasPrefix(trimStart(line), "#") {
			continue
		}
		keyMatch := yamlKeyRe.FindStringSubmatch(line)
		if keyMatch == nil {
			continue
		}
		key := strings.TrimSpace(keyMatch[1])
		rest := ""
		if len(keyMatch) > 2 {
			rest = keyMatch[2]
		}
		if strings.TrimSpace(rest) != "" {
			values[key] = parseScalarOrInlineArray(strings.TrimSpace(rest))
			keys = append(keys, key)
			continue
		}
		var childLines []string
		for index < len(lines) {
			if !yamlIndent.MatchString(lines[index]) {
				break
			}
			childLines = append(childLines, strings.TrimPrefix(lines[index], "  "))
			index++
		}
		values[key] = parseIndentedBlock(childLines)
		keys = append(keys, key)
	}
	return values, keys
}

func parseIndentedBlock(lines []string) any {
	if len(lines) == 0 {
		return nil
	}
	allList := true
	for _, line := range lines {
		if !yamlListRe.MatchString(line) {
			allList = false
			break
		}
	}
	if allList {
		out := make([]any, 0, len(lines))
		for _, line := range lines {
			m := yamlItemRe.FindStringSubmatch(line)
			item := ""
			if m != nil {
				item = strings.TrimSpace(m[1])
			}
			out = append(out, parseScalarOrInlineArray(item))
		}
		return out
	}
	values, _ := parseYamlSubset(strings.Join(lines, "\n"))
	return values
}

func parseScalarOrInlineArray(value string) any {
	if strings.HasPrefix(value, "[") && strings.HasSuffix(value, "]") {
		inner := strings.TrimSpace(value[1 : len(value)-1])
		if inner == "" {
			return []any{}
		}
		items := splitCSV(inner)
		out := make([]any, 0, len(items))
		for _, item := range items {
			out = append(out, stringifyScalar(parseScalar(strings.TrimSpace(item))))
		}
		return out
	}
	return parseScalar(value)
}

func stringifyScalar(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case bool:
		if t {
			return "true"
		}
		return "false"
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case nil:
		return ""
	default:
		return ""
	}
}

func parseScalar(value string) any {
	unquoted := stripQuotes(value)
	if unquoted == "" {
		return ""
	}
	lower := strings.ToLower(unquoted)
	if lower == "true" || lower == "yes" {
		return true
	}
	if lower == "false" || lower == "no" {
		return false
	}
	if yamlNumber.MatchString(unquoted) {
		n, err := strconv.ParseFloat(unquoted, 64)
		if err == nil {
			return n
		}
	}
	return unquoted
}

func stripQuotes(value string) string {
	if len(value) >= 2 {
		if (value[0] == '"' && value[len(value)-1] == '"') ||
			(value[0] == '\'' && value[len(value)-1] == '\'') {
			return value[1 : len(value)-1]
		}
	}
	return value
}

func splitCSV(value string) []string {
	var items []string
	current := strings.Builder{}
	var quote byte
	for i := 0; i < len(value); i++ {
		char := value[i]
		if (char == '"' || char == '\'') && (quote == 0 || quote == char) {
			if quote == 0 {
				quote = char
			} else {
				quote = 0
			}
			current.WriteByte(char)
			continue
		}
		if char == ',' && quote == 0 {
			items = append(items, current.String())
			current.Reset()
			continue
		}
		current.WriteByte(char)
	}
	if current.Len() > 0 {
		items = append(items, current.String())
	}
	return items
}

func trimStart(s string) string {
	return strings.TrimLeftFunc(s, func(r rune) bool {
		return r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == '\f' || r == '\v'
	})
}

func isSpace(b byte) bool {
	return b == ' ' || b == '\t' || b == '\n' || b == '\r' || b == '\f' || b == '\v'
}
