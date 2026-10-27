package mdmeta

import (
	"regexp"
	"strings"
)

// The reader's own, not attention's (its MetadataCache skips external
// links): the http(s) addresses a note names, so the index links notes and
// web pages that cite the same URL (RFC 0001 §5.6).

var urlRe = regexp.MustCompile(`(?i)\bhttps?://[^\s<>"'` + "`" + `\]\[{}|\\^]+`)

// collectURLs are the http(s) addresses on lines not in a fenced code
// block, the frontmatter's included: markdown links' targets, autolinks
// and bare addresses alike.
func collectURLs(lines []string, offsets []int, fences []bool) []Link {
	var out []Link
	for n, line := range lines {
		if n < len(fences) && fences[n] {
			continue
		}
		for _, loc := range urlRe.FindAllStringIndex(line, -1) {
			start, end := loc[0], trimURL(line[loc[0]:loc[1]])+loc[0]
			u := line[start:end]
			out = append(out, Link{Link: u, Original: u, Position: inlineRangeToPosition(offsets, n, start, end),
				Source: SourceMatch{Line: n, Start: start, End: end, Text: line}})
		}
	}
	return out
}

// trimURL is where a matched address ends: without trailing punctuation,
// and without a closing parenthesis it did not open (a markdown link's).
func trimURL(u string) int {
	end := len(u)
	for end > 0 {
		c := u[end-1]
		switch {
		case strings.IndexByte(".,;:!?*_~'\"", c) >= 0:
			end--
		case c == ')' && strings.Count(u[:end], "(") < strings.Count(u[:end], ")"):
			end--
		default:
			return end
		}
	}
	return end
}
