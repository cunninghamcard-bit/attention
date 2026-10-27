// Package pluginreg is where a plugin compiled into a custom attention
// (`attention build --with <module>`, RFC 0001 §5.11) adds itself: its
// package's init calls Add, and the binary carries it and gives it a row.
//
//	func init() { pluginreg.Add(Plugin, pluginreg.UI) }
package pluginreg

import (
	"sync"

	"github.com/arcships/rutis/go/rutis"
)

// Side is where a plugin runs (RFC §6): UI plugins in the window's
// process, desktop profile only; service plugins in every profile.
type Side int

const (
	Service Side = iota
	UI
)

// Extra is a plugin added with Add.
type Extra struct {
	Def  *rutis.Definition
	Side Side
}

var (
	mu     sync.Mutex
	extras []Extra
)

// Add carries def in this binary, with a row of its own.
func Add(def *rutis.Definition, side Side) {
	mu.Lock()
	defer mu.Unlock()
	extras = append(extras, Extra{def, side})
}

// List is the plugins added, in the order they were.
func List() []Extra {
	mu.Lock()
	defer mu.Unlock()
	return append([]Extra(nil), extras...)
}
