// Package fuzzy is attention's search matching, ported from
// apps/web/search/SearchHelpers.ts (prepareQuery, fuzzySearch,
// prepareSimpleSearch and their scoring). The quick switcher, the command
// palette and link suggestions rank with it.
//
// Offsets are in runes where the TS counts UTF-16 units; they differ only
// for characters outside the Basic Multilingual Plane.
package fuzzy

import (
	"sort"
	"strings"
	"unicode"
)

// Match is a matched [start, end) range of the text.
type Match [2]int

// Result is a successful match: a higher Score is better (scores are 0 or
// negative), and Matches are the ranges to highlight.
type Result struct {
	Score   float64
	Matches []Match
}

// Query is a prepared fuzzy query.
type Query struct {
	Query  string
	Tokens []string
	Fuzzy  []string
}

// isPunctuation is PUNCTUATION_RE: the general punctuation and supplemental
// punctuation blocks, and ASCII punctuation.
func isPunctuation(r rune) bool {
	if r >= 0x2000 && r <= 0x206F || r >= 0x2E00 && r <= 0x2E7F {
		return true
	}
	return strings.ContainsRune("\\'!\"#$%&()*+,-./:;<=>?@[]^_`{|}~", r)
}

// isCJK is CJK_RE.
func isCJK(r rune) bool {
	return r >= 0x0F00 && r <= 0x0FFF || r >= 0x3040 && r <= 0x30FF || r >= 0x3400 && r <= 0x4DBF ||
		r >= 0x4E00 && r <= 0x9FFF || r >= 0xF900 && r <= 0xFAFF || r >= 0xFF66 && r <= 0xFF9F
}

// Prepare splits a query into tokens (words, and each punctuation or CJK
// character alone) and into single characters for the fuzzy fallback.
func Prepare(query string) Query {
	lower := []rune(strings.ToLower(query))
	q := Query{Query: query}
	start := 0
	for i, r := range lower {
		switch {
		case unicode.IsSpace(r):
			if start != i {
				q.Tokens = append(q.Tokens, string(lower[start:i]))
			}
			start = i + 1
		case isPunctuation(r) || isCJK(r):
			if start != i {
				q.Tokens = append(q.Tokens, string(lower[start:i]))
			}
			q.Tokens = append(q.Tokens, string(r))
			start = i + 1
		}
	}
	if start != len(lower) {
		q.Tokens = append(q.Tokens, string(lower[start:]))
	}
	for _, r := range lower {
		if r != ' ' {
			q.Fuzzy = append(q.Fuzzy, string(r))
		}
	}
	return q
}

// Search matches a prepared query against text: its tokens in order first,
// then its characters in order, each at a word start.
func Search(q Query, text string) *Result {
	if q.Query == "" {
		return &Result{}
	}
	if r := matchTokens(q.Tokens, q.Query, text, false); r != nil {
		return r
	}
	return matchTokens(q.Fuzzy, q.Query, text, true)
}

func indexFrom(text, token []rune, from int) int {
	if from < 0 {
		from = 0
	}
	for i := from; i+len(token) <= len(text); i++ {
		match := true
		for j := range token {
			if text[i+j] != token[j] {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}

func matchTokens(tokens []string, query, text string, strictStart bool) *Result {
	if len(tokens) == 0 {
		return nil
	}
	orig := []rune(text)
	lower := []rune(strings.ToLower(text))
	if len(lower) != len(orig) {
		lower = make([]rune, len(orig)) // keep offsets aligned with text
		for i, r := range orig {
			lower[i] = unicode.ToLower(r)
		}
	}
	skipped, cursor := 0, 0
	var matches []Match
	for i := 0; i < len(tokens); i++ {
		token := []rune(tokens[i])
		found := indexFrom(lower, token, cursor)
		if found == -1 {
			return nil
		}
		c := orig[found]
		if found > 0 && !isPunctuation(c) && !isCJK(c) {
			prev := orig[found-1]
			badCamelStart := (unicode.IsUpper(c) && unicode.IsUpper(prev)) ||
				(unicode.IsLower(c) && !isPunctuation(prev) && !unicode.IsSpace(prev) && !isCJK(prev))
			if badCamelStart {
				if strictStart {
					if found != cursor {
						cursor += len(token)
						i--
						continue
					}
				} else {
					skipped++
				}
			}
		}
		matches = mergeAdjacent(matches, Match{found, found + len(token)})
		cursor = found + len(token)
	}
	return &Result{Matches: matches, Score: score(matches, len([]rune(query)), len(lower), skipped)}
}

// PrepareSimple is prepareSimpleSearch: every space-separated word must
// occur somewhere, all occurrences highlighted.
func PrepareSimple(query string) func(text string) *Result {
	tokens := strings.Split(strings.ToLower(query), " ")
	return func(text string) *Result {
		lower := []rune(strings.ToLower(text))
		var matches []Match
		for _, t := range tokens {
			if t == "" {
				continue
			}
			token := []rune(t)
			found := false
			for at := indexFrom(lower, token, 0); at != -1; at = indexFrom(lower, token, at+len(token)+1) {
				found = true
				matches = append(matches, Match{at, at + len(token)})
			}
			if !found {
				return nil
			}
		}
		matches = merge(matches)
		return &Result{Matches: matches, Score: score(matches, len([]rune(query)), len([]rune(text)), 0)}
	}
}

func score(matches []Match, queryLen, textLen, skipped int) float64 {
	if len(matches) == 0 {
		return 0
	}
	s := -float64(max(0, len(matches)-1))
	s -= float64(skipped) / 10
	first := matches[0][0]
	s -= float64(matches[len(matches)-1][1]-first+1-queryLen) / 100
	s -= float64(first) / 1000
	s -= float64(textLen) / 10000
	return s
}

func mergeAdjacent(matches []Match, next Match) []Match {
	if len(matches) == 0 {
		return append(matches, next)
	}
	prev := &matches[len(matches)-1]
	if prev[1] < next[0] {
		return append(matches, next)
	}
	prev[1] = max(prev[1], next[1])
	return matches
}

func merge(matches []Match) []Match {
	if len(matches) == 0 {
		return matches
	}
	sort.SliceStable(matches, func(i, j int) bool { return matches[i][0] < matches[j][0] })
	out := []Match{matches[0]}
	for _, m := range matches[1:] {
		prev := &out[len(out)-1]
		if prev[1] < m[0] {
			out = append(out, m)
		} else if prev[1] < m[1] {
			prev[1] = m[1]
		}
	}
	return out
}

// Ranked is one item that matched.
type Ranked struct {
	Index  int
	Result *Result
}

// Rank is FuzzySuggestModal.getSuggestions with sortSearchResults: the
// items whose text matches, best score first, ties in item order, at most
// limit (0 for all).
func Rank(query string, n int, text func(i int) string, limit int) []Ranked {
	q := Prepare(strings.TrimSpace(query))
	var out []Ranked
	for i := 0; i < n; i++ {
		if r := Search(q, text(i)); r != nil {
			out = append(out, Ranked{i, r})
		}
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].Result.Score > out[b].Result.Score })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
}
