// Input: os
// Output: None
// Pos: Application code
//
// 🔄 Self-reference: When this file changes, update this header

// Adapted from github.com/dimetron/pi-go internal/tui
//go:build windows

package main

import "os"

func setNonBlock(_ *os.File) error { return nil }
func setBlock(_ *os.File) error    { return nil }