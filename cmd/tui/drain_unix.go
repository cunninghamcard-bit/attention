// Adapted from github.com/dimetron/pi-go internal/tui
//go:build !windows

package main

import (
	"os"
	"syscall"
)

func setNonBlock(f *os.File) error {
	return syscall.SetNonblock(int(f.Fd()), true)
}

func setBlock(f *os.File) error {
	return syscall.SetNonblock(int(f.Fd()), false)
}