// Input: bufio
// Output: HistoryEntry
// Pos: Application code
//
// 🔄 Self-reference: When this file changes, update this header

// Adapted from github.com/dimetron/pi-go internal/tui
package main

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
)

const (
	historyFile     = "history"
	historyFileJSON = "history.jsonl"
	maxHistorySize  = 1000
)

// HistoryEntry stores a single prompt with its full input state.
type HistoryEntry struct {
	Text     string   `json:"text"`
	Mentions []string `json:"mentions,omitempty"`
}

// historyDir returns the path to ~/.pi-go/.
func historyDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".pi-go")
}

// historyPathJSON returns the path to the JSONL history file.
func historyPathJSON() string {
	dir := historyDir()
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, historyFileJSON)
}

// historyPathPlain returns the path to the legacy plain-text history file.
func historyPathPlain() string {
	dir := historyDir()
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, historyFile)
}

// loadHistory reads command history from disk (JSONL format).
// On first run, migrates from legacy plain-text format if present.
func loadHistory() []HistoryEntry {
	jsonPath := historyPathJSON()
	if jsonPath == "" {
		return nil
	}

	// Try JSONL first.
	if entries := loadHistoryJSON(jsonPath); entries != nil {
		return entries
	}

	// Migrate from legacy plain-text format.
	plainPath := historyPathPlain()
	if plainPath == "" {
		return nil
	}
	lines := loadHistoryPlain(plainPath)
	if len(lines) == 0 {
		return nil
	}

	entries := migrateHistoryFormat(lines)

	// Write migrated entries to JSONL.
	if err := os.MkdirAll(filepath.Dir(jsonPath), 0o700); err == nil {
		if f, err := os.OpenFile(jsonPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600); err == nil {
			enc := json.NewEncoder(f)
			for _, e := range entries {
				_ = enc.Encode(e)
			}
			f.Close()
		}
	}

	return entries
}

// migrateHistoryFormat converts plain-text lines to HistoryEntry structs.
func migrateHistoryFormat(lines []string) []HistoryEntry {
	entries := make([]HistoryEntry, len(lines))
	for i, line := range lines {
		entries[i] = HistoryEntry{Text: line}
	}
	return entries
}



// loadHistoryJSON reads JSONL history entries.
func loadHistoryJSON(path string) []HistoryEntry {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	var entries []HistoryEntry
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 256*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var e HistoryEntry
		if json.Unmarshal(line, &e) == nil && e.Text != "" {
			entries = append(entries, e)
		}
	}

	if len(entries) > maxHistorySize {
		entries = entries[len(entries)-maxHistorySize:]
	}
	return entries
}

// loadHistoryPlain reads legacy plain-text history (one entry per line).
func loadHistoryPlain(path string) []string {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	var lines []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if line != "" {
			lines = append(lines, line)
		}
	}

	if len(lines) > maxHistorySize {
		lines = lines[len(lines)-maxHistorySize:]
	}
	return lines
}

// appendHistory adds a single entry to the persistent JSONL history file.
func appendHistory(entry HistoryEntry) {
	path := historyPathJSON()
	if path == "" {
		return
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return
	}

	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer f.Close()

	_ = json.NewEncoder(f).Encode(entry)
}
