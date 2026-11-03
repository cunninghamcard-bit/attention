package ui

import (
	"strconv"
	"strings"

	"github.com/egoist/mygo/ui"
)

// ParseColor reads "#rgb", "#rrggbb" or "#rrggbbaa"; ok is false for
// anything else, as a hand-edited file may hold.
func ParseColor(raw string) (ui.Color, bool) {
	h := strings.TrimPrefix(strings.TrimSpace(raw), "#")
	if len(h) == 3 {
		h = string([]byte{h[0], h[0], h[1], h[1], h[2], h[2]})
	}
	if len(h) != 6 && len(h) != 8 {
		return ui.Color{}, false
	}
	v, err := strconv.ParseUint(h, 16, 32)
	if err != nil {
		return ui.Color{}, false
	}
	if len(h) == 6 {
		v = v<<8 | 0xff
	}
	return ui.Color{R: uint8(v >> 24), G: uint8(v >> 16), B: uint8(v >> 8), A: uint8(v)}, true
}
