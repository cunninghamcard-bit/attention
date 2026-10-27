package mdmeta

import (
	"bytes"
	"encoding/json"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

var (
	yamlQuoteSpecial = regexp.MustCompile("[:#[\\]{},&*?|\\-<>=!%@`]")
	yamlQuoteSpace   = regexp.MustCompile(`^\s|\s$`)
)

// FrontmatterMap is an insertion-ordered YAML-subset mapping. It ports the
// Record<string, PropertyValue> that apps/web/metadata/Frontmatter.ts mutates.
type FrontmatterMap struct {
	keys []string
	vals map[string]any
}

func newFrontmatterMap() *FrontmatterMap {
	return &FrontmatterMap{vals: map[string]any{}}
}

func orderedFrontmatter(parsed ParsedFrontmatter) *FrontmatterMap {
	if !parsed.Valid || !parsed.HasFrontmatter {
		return newFrontmatterMap()
	}
	return parseOrderedYamlSubset(parsed.Raw)
}

func parseOrderedYamlSubset(raw string) *FrontmatterMap {
	values := newFrontmatterMap()
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
			values.Set(key, parseScalarOrInlineArray(strings.TrimSpace(rest)))
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
		values.Set(key, parseOrderedIndentedBlock(childLines))
	}
	return values
}

// Set assigns key, keeping its place if it already exists and appending if not.
func (m *FrontmatterMap) Set(key string, value any) {
	if m.vals == nil {
		m.vals = map[string]any{}
	}
	if _, ok := m.vals[key]; !ok {
		m.keys = append(m.keys, key)
	}
	m.vals[key] = value
}

// Delete removes key. A missing key is a no-op, as JS delete is.
func (m *FrontmatterMap) Delete(key string) {
	if m == nil || m.vals == nil {
		return
	}
	if _, ok := m.vals[key]; !ok {
		return
	}
	delete(m.vals, key)
	for i, k := range m.keys {
		if k == key {
			m.keys = append(m.keys[:i], m.keys[i+1:]...)
			return
		}
	}
}

func (m *FrontmatterMap) clear() {
	m.keys = m.keys[:0]
	m.vals = map[string]any{}
}

func (m *FrontmatterMap) assign(src *FrontmatterMap) {
	if src == nil {
		return
	}
	for _, k := range src.keys {
		m.Set(k, src.vals[k])
	}
}

type kv struct {
	key   string
	value any
}

// SetFrontmatterProperty writes one property, dropping it when value is null
// or an empty array.
// It ports setFrontmatterProperty from apps/web/metadata/Frontmatter.ts.
func SetFrontmatterProperty(source, propertyID string, value any) string {
	return UpdateFrontmatter(source, func(values *FrontmatterMap) {
		if value == nil || isEmptyArray(value) {
			values.Delete(propertyID)
			return
		}
		values.Set(propertyID, value)
	})
}

// DeleteFrontmatterProperty drops one key.
// It ports deleteFrontmatterProperty from apps/web/metadata/Frontmatter.ts.
func DeleteFrontmatterProperty(source, propertyID string) string {
	return UpdateFrontmatter(source, func(values *FrontmatterMap) {
		values.Delete(propertyID)
	})
}

// UpdateFrontmatter parses the note, mutates the mapping, and serializes.
// Invalid frontmatter is left byte-for-byte.
// It ports updateFrontmatter from apps/web/metadata/Frontmatter.ts.
func UpdateFrontmatter(source string, update func(*FrontmatterMap)) string {
	parsed := ParseFrontmatter(source)
	if !parsed.Valid {
		return source
	}
	values := orderedFrontmatter(parsed)
	update(values)
	return writeFrontmatter(parsed.Body, values)
}

// ProcessFrontMatter is FileManager.processFrontMatter's transform: the
// handler mutates a copy of the mapping, then the note is rewritten with
// that mapping (body untouched, frontmatter re-serialized).
// It ports processFrontMatter from apps/web/app/FileManager.ts.
func ProcessFrontMatter(source string, handler func(*FrontmatterMap)) string {
	parsed := ParseFrontmatter(source)
	frontmatter := orderedFrontmatter(parsed)
	handler(frontmatter)
	if !parsed.Valid {
		return source
	}
	return UpdateFrontmatter(source, func(values *FrontmatterMap) {
		values.clear()
		values.assign(frontmatter)
	})
}

// SerializeFrontmatter is the --- block for values, or "" when there is
// nothing to write. Empty arrays are omitted; key order is kept.
// It ports serializeFrontmatter from apps/web/metadata/Frontmatter.ts.
func SerializeFrontmatter(values *FrontmatterMap) string {
	if values == nil {
		return ""
	}
	var keys []string
	for _, k := range values.keys {
		if isEmptyArray(values.vals[k]) {
			continue
		}
		keys = append(keys, k)
	}
	if len(keys) == 0 {
		return ""
	}
	lines := []string{"---"}
	for _, k := range keys {
		lines = append(lines, serializeProperty(k, values.vals[k])...)
	}
	lines = append(lines, "---", "")
	return strings.Join(lines, "\n")
}

func writeFrontmatter(body string, values *FrontmatterMap) string {
	block := SerializeFrontmatter(values)
	if block == "" {
		return stripOneLeadingNL(body)
	}
	return block + body
}

func stripOneLeadingNL(body string) string {
	if strings.HasPrefix(body, "\r\n") {
		return body[2:]
	}
	if strings.HasPrefix(body, "\n") {
		return body[1:]
	}
	return body
}

func parseOrderedIndentedBlock(lines []string) any {
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
	return parseOrderedYamlSubset(strings.Join(lines, "\n"))
}

func serializeProperty(key string, value any) []string {
	if items, ok := asSlice(value); ok {
		if len(items) == 0 {
			return nil
		}
		out := []string{key + ":"}
		for _, item := range items {
			out = append(out, serializeArrayItem(item, 2)...)
		}
		return out
	}
	if entries, ok := objectEntries(value); ok {
		if len(entries) == 0 {
			return []string{key + ": {}"}
		}
		out := []string{key + ":"}
		for _, e := range entries {
			out = append(out, indentLines(serializeProperty(e.key, e.value), 2)...)
		}
		return out
	}
	if value == nil {
		return []string{key + ":"}
	}
	return []string{key + ": " + quoteIfNeeded(value)}
}

func serializeArrayItem(value any, indent int) []string {
	prefix := strings.Repeat(" ", indent)
	if items, ok := asSlice(value); ok {
		if len(items) == 0 {
			return []string{prefix + "- []"}
		}
		out := []string{prefix + "-"}
		for _, item := range items {
			out = append(out, serializeArrayItem(item, indent+2)...)
		}
		return out
	}
	if entries, ok := objectEntries(value); ok {
		if len(entries) == 0 {
			return []string{prefix + "- {}"}
		}
		var propLines []string
		for _, e := range entries {
			propLines = append(propLines, serializeProperty(e.key, e.value)...)
		}
		first, rest := propLines[0], propLines[1:]
		out := []string{prefix + "- " + first}
		for _, line := range rest {
			out = append(out, prefix+"  "+line)
		}
		return out
	}
	if value == nil {
		return []string{prefix + "- null"}
	}
	return []string{prefix + "- " + quoteIfNeeded(value)}
}

func indentLines(lines []string, spaces int) []string {
	prefix := strings.Repeat(" ", spaces)
	out := make([]string, len(lines))
	for i, line := range lines {
		out[i] = prefix + line
	}
	return out
}

func quoteIfNeeded(value any) string {
	switch t := value.(type) {
	case float64:
		return formatJSNumber(t)
	case float32:
		return formatJSNumber(float64(t))
	case int:
		return strconv.Itoa(t)
	case int64:
		return strconv.FormatInt(t, 10)
	case json.Number:
		if i, err := t.Int64(); err == nil {
			return strconv.FormatInt(i, 10)
		}
		f, err := t.Float64()
		if err != nil {
			return t.String()
		}
		return formatJSNumber(f)
	case bool:
		if t {
			return "true"
		}
		return "false"
	case string:
		if t == "" {
			return `""`
		}
		if yamlQuoteSpecial.MatchString(t) || yamlQuoteSpace.MatchString(t) {
			return jsonQuote(t)
		}
		return t
	case nil:
		return "null"
	default:
		return jsonQuote(stringifyUnknown(t))
	}
}

func stringifyUnknown(v any) string {
	switch t := v.(type) {
	case string:
		return t
	default:
		return strings.TrimSpace(string(mustJSON(v)))
	}
}

func mustJSON(v any) []byte {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return []byte(`""`)
	}
	return bytes.TrimSpace(b.Bytes())
}

func jsonQuote(s string) string {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(s); err != nil {
		t, _ := json.Marshal(s)
		return string(t)
	}
	return strings.TrimSpace(b.String())
}

func formatJSNumber(n float64) string {
	if math.IsNaN(n) {
		return "NaN"
	}
	if math.IsInf(n, 1) {
		return "Infinity"
	}
	if math.IsInf(n, -1) {
		return "-Infinity"
	}
	if n == 0 {
		return "0"
	}
	abs := math.Abs(n)
	if abs >= 1e21 || abs < 1e-6 {
		return strconv.FormatFloat(n, 'e', -1, 64)
	}
	return strconv.FormatFloat(n, 'f', -1, 64)
}

func asSlice(value any) ([]any, bool) {
	switch t := value.(type) {
	case []any:
		return t, true
	case []string:
		out := make([]any, len(t))
		for i, s := range t {
			out[i] = s
		}
		return out, true
	}
	return nil, false
}

func objectEntries(value any) ([]kv, bool) {
	switch t := value.(type) {
	case *FrontmatterMap:
		if t == nil {
			return nil, false
		}
		var out []kv
		for _, k := range t.keys {
			v := t.vals[k]
			if v == nil || isEmptyArray(v) {
				continue
			}
			out = append(out, kv{k, v})
		}
		return out, true
	case map[string]any:
		if t == nil {
			return nil, false
		}
		var keys []string
		for k, v := range t {
			if v == nil || isEmptyArray(v) {
				continue
			}
			keys = append(keys, k)
		}
		sort.Strings(keys)
		out := make([]kv, len(keys))
		for i, k := range keys {
			out[i] = kv{k, t[k]}
		}
		return out, true
	}
	return nil, false
}

func isEmptyArray(value any) bool {
	switch t := value.(type) {
	case []any:
		return len(t) == 0
	case []string:
		return len(t) == 0
	}
	return false
}
