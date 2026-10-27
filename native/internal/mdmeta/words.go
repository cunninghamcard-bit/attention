package mdmeta

import (
	"regexp"
	"sort"
)

// stripFrontmatterRe ports stripFrontmatter from apps/web/builtin/WordCount.ts.
var stripFrontmatterRe = regexp.MustCompile(`(?s)^---\s*\n.*?\n---\s*(?:\n|$)`)

// StripFrontmatter drops a leading --- YAML block.
// It ports stripFrontmatter from apps/web/builtin/WordCount.ts.
func StripFrontmatter(source string) string {
	return stripFrontmatterRe.ReplaceAllString(source, "")
}

// CountWords counts words with Obsidian's Aee regex and whitespace-free
// characters as Unicode code points.
// It ports countWords from apps/web/builtin/WordCount.ts.
func CountWords(source string) WordCount {
	chars := 0
	for _, r := range source {
		if !isJSSpace(r) {
			chars++
		}
	}
	rs := []rune(source)
	words := 0
	for i := 0; i < len(rs); {
		if n := consumeWord(rs, i); n > 0 {
			words++
			i += n
			continue
		}
		i++
	}
	return WordCount{Words: words, Characters: chars}
}

func consumeWord(rs []rune, i int) int {
	start := i
	for i < len(rs) {
		if n := consumeDigits(rs, i); n > 0 {
			i += n
			continue
		}
		if inRanges(rs[i], wordCharRanges) {
			i++
			continue
		}
		break
	}
	if i > start {
		return i - start
	}
	if inRanges(rs[start], cjkCharRanges) {
		return 1
	}
	return 0
}

func consumeDigits(rs []rune, i int) int {
	if i >= len(rs) || rs[i] < '0' || rs[i] > '9' {
		return 0
	}
	j := i + 1
	for j < len(rs) && rs[j] >= '0' && rs[j] <= '9' {
		j++
	}
	for j < len(rs) && (rs[j] == ',' || rs[j] == '.') {
		if j+1 >= len(rs) || rs[j+1] < '0' || rs[j+1] > '9' {
			break
		}
		j++
		for j < len(rs) && rs[j] >= '0' && rs[j] <= '9' {
			j++
		}
	}
	return j - i
}

func inRanges(r rune, rs [][2]rune) bool {
	i := sort.Search(len(rs), func(i int) bool { return rs[i][1] >= r })
	return i < len(rs) && rs[i][0] <= r
}

func isJSSpace(r rune) bool {
	switch r {
	case ' ', '\t', '\n', '\r', '\f', '\v', '\u00a0', '\u1680',
		'\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff':
		return true
	}
	return r >= '\u2000' && r <= '\u200a'
}
