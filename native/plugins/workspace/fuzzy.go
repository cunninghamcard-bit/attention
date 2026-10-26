package workspace

import (
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

// fuzzyScore scores how well query matches candidate as an ordered
// subsequence, without case: 0 means no match. Matches score more at word
// starts (after / _ - . space or a lower→upper change), when consecutive,
// and inside the last path element; a shorter candidate wins ties.
func fuzzyScore(query, candidate string) int {
	if query == "" {
		return 1
	}
	q := []rune(strings.ToLower(query))
	c := []rune(candidate)
	lc := []rune(strings.ToLower(candidate))
	base := strings.LastIndexByte(candidate, '/') + 1
	baseRune := utf8.RuneCountInString(candidate[:base])

	score, qi, prev := 0, 0, -2
	for i := 0; i < len(lc) && qi < len(q); i++ {
		if q[qi] == ' ' { // a space in the query matches nothing in particular
			qi++
			if qi == len(q) {
				break
			}
		}
		if lc[i] != q[qi] {
			continue
		}
		s := 1
		if i == 0 || isBoundary(c[i-1], c[i]) {
			s += 8
		}
		if prev == i-1 {
			s += 5
		}
		if i >= baseRune {
			s += 3
		}
		score += s
		prev = i
		qi++
	}
	for qi < len(q) && q[qi] == ' ' {
		qi++
	}
	if qi < len(q) {
		return 0
	}
	// Prefer short candidates and an exact base-name prefix.
	if strings.HasPrefix(strings.ToLower(candidate[base:]), strings.ToLower(strings.TrimSpace(query))) {
		score += 20
	}
	score = score*1000/(1000+len(c)) + 1
	return score
}

func isBoundary(prev, cur rune) bool {
	switch prev {
	case '/', '_', '-', '.', ' ', '\\':
		return true
	}
	return unicode.IsLower(prev) && unicode.IsUpper(cur)
}

// ranked is one fuzzy result.
type ranked struct {
	index int
	score int
}

// rank returns the indices of the candidates matching query, best first,
// at most limit of them.
func rank(query string, n int, text func(i int) string, limit int) []int {
	var hits []ranked
	for i := 0; i < n; i++ {
		if s := fuzzyScore(query, text(i)); s > 0 {
			hits = append(hits, ranked{i, s})
		}
	}
	sort.SliceStable(hits, func(a, b int) bool {
		if hits[a].score != hits[b].score {
			return hits[a].score > hits[b].score
		}
		return len(text(hits[a].index)) < len(text(hits[b].index))
	})
	if len(hits) > limit {
		hits = hits[:limit]
	}
	out := make([]int, len(hits))
	for i, h := range hits {
		out[i] = h.index
	}
	return out
}
