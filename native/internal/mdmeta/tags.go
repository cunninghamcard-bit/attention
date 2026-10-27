package mdmeta

import (
	"regexp"
	"strings"
)

var (
	aliasesKeyRe = regexp.MustCompile(`(?i)^aliases$`)
	tagsKeyRe    = regexp.MustCompile(`(?i)^tags$`)
)

// ParseFrontMatterEntry returns the value of an exact frontmatter key, or nil.
// It ports parseFrontMatterEntry (string key) from apps/web/metadata/FrontmatterTags.ts.
func ParseFrontMatterEntry(frontmatter map[string]any, key string) any {
	if frontmatter == nil {
		return nil
	}
	v, ok := frontmatter[key]
	if !ok {
		return nil
	}
	return v
}

// ParseFrontMatterEntryPattern returns the first frontmatter value whose key matches pattern, or nil.
// It ports parseFrontMatterEntry (RegExp key) from apps/web/metadata/FrontmatterTags.ts.
func ParseFrontMatterEntryPattern(frontmatter map[string]any, pattern *regexp.Regexp) any {
	if frontmatter == nil || pattern == nil {
		return nil
	}
	for k, v := range frontmatter {
		if pattern.MatchString(k) {
			return v
		}
	}
	return nil
}

// ParseFrontMatterStringArray reads a string or string-list property.
// It ports parseFrontMatterStringArray from apps/web/metadata/FrontmatterTags.ts.
func ParseFrontMatterStringArray(frontmatter map[string]any, key string) []string {
	return coerceStringArray(ParseFrontMatterEntry(frontmatter, key))
}

// ParseFrontMatterStringArrayPattern reads a string or string-list property whose key matches pattern.
// It ports parseFrontMatterStringArray (RegExp key) from apps/web/metadata/FrontmatterTags.ts.
func ParseFrontMatterStringArrayPattern(frontmatter map[string]any, pattern *regexp.Regexp) []string {
	return coerceStringArray(ParseFrontMatterEntryPattern(frontmatter, pattern))
}

// ParseFrontMatterAliases is the aliases: list, empty strings dropped.
// It ports parseFrontMatterAliases from apps/web/metadata/FrontmatterTags.ts.
func ParseFrontMatterAliases(frontmatter map[string]any) []string {
	aliases := ParseFrontMatterStringArrayPattern(frontmatter, aliasesKeyRe)
	if aliases == nil {
		return nil
	}
	out := make([]string, 0, len(aliases))
	for _, a := range aliases {
		if a != "" {
			out = append(out, a)
		}
	}
	return out
}

// ParseFrontMatterTags is the tags: list, hashed and with spaces dropped.
// It ports parseFrontMatterTags from apps/web/metadata/FrontmatterTags.ts.
func ParseFrontMatterTags(frontmatter map[string]any) []string {
	tags := ParseFrontMatterStringArrayPattern(frontmatter, tagsKeyRe)
	if tags == nil {
		return nil
	}
	out := make([]string, 0, len(tags))
	for _, tag := range tags {
		if len(tag) == 0 || strings.Contains(tag, " ") {
			continue
		}
		if strings.HasPrefix(tag, "#") {
			out = append(out, tag)
		} else {
			out = append(out, "#"+tag)
		}
	}
	return out
}

// AllTags is frontmatter tags followed by inline tags.
// It ports getAllTags from apps/web/metadata/FrontmatterTags.ts.
func AllTags(cache Metadata) []string {
	var tags []string
	for _, tag := range ParseFrontMatterTags(cache.Frontmatter) {
		tags = append(tags, tag)
	}
	for _, entry := range cache.Tags {
		tags = append(tags, entry.Tag)
	}
	if tags == nil {
		return []string{}
	}
	return tags
}

// Aliases is the frontmatter aliases: list.
// It ports parseFrontMatterAliases over Metadata.Frontmatter.
func Aliases(cache Metadata) []string {
	return ParseFrontMatterAliases(cache.Frontmatter)
}

func coerceStringArray(value any) []string {
	if isJSFalsy(value) {
		return nil
	}
	switch v := value.(type) {
	case string:
		return []string{strings.TrimSpace(v)}
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			s, ok := item.(string)
			if !ok {
				continue
			}
			out = append(out, strings.TrimSpace(s))
		}
		return out
	case []string:
		out := make([]string, 0, len(v))
		for _, item := range v {
			out = append(out, strings.TrimSpace(item))
		}
		return out
	}
	return nil
}

func isJSFalsy(value any) bool {
	if value == nil {
		return true
	}
	switch v := value.(type) {
	case bool:
		return !v
	case string:
		return v == ""
	case float64:
		return v == 0
	case int:
		return v == 0
	}
	return false
}
