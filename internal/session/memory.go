package session

import (
	"fmt"
	"sync"
)

// InMemorySessionStorage is an ephemeral SessionStorage that keeps every entry
// in memory and never touches disk. It backs --no-session: an orchestrator
// built around it behaves exactly like a persisted session for the duration of
// the process, but nothing is written and the conversation vanishes on exit.
//
// It mirrors JsonlSessionStorage's in-memory bookkeeping (entries slice, byID
// index, leaf pointer, label cache) and reuses the same EntryID generator, but
// drops all persistence (no header, no flush, no file).
type InMemorySessionStorage struct {
	mu       sync.Mutex
	metadata Metadata
	entries  []SessionEntry
	byID     map[EntryID]int
	leafID   *EntryID
	labels   map[EntryID]string
}

// NewInMemorySessionStorage returns an ephemeral storage rooted at cwd. The
// metadata carries a freshly generated id and the cwd so downstream code (system
// prompt, context-file loading) sees a normal-looking session.
func NewInMemorySessionStorage(cwd string) *InMemorySessionStorage {
	return &InMemorySessionStorage{
		metadata: Metadata{
			ID:        newRandomID(),
			CWD:       cwd,
			CreatedAt: newTimestamp(),
		},
		entries: []SessionEntry{},
		byID:    map[EntryID]int{},
		labels:  map[EntryID]string{},
	}
}

// NewInMemorySession wraps an ephemeral InMemorySessionStorage in a *Session.
// Pass the result to orchestrator.New as opts.Session to bypass repo.Create
// entirely (--no-session): nothing is persisted.
func NewInMemorySession(cwd string) *Session {
	return NewSession(NewInMemorySessionStorage(cwd))
}

var _ SessionStorage = (*InMemorySessionStorage)(nil)

func (s *InMemorySessionStorage) GetMetadata() Metadata {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.metadata
}

func (s *InMemorySessionStorage) GetLeafID() (*EntryID, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.leafID != nil {
		if _, ok := s.byID[*s.leafID]; !ok {
			return nil, sessionError(ErrorInvalidSession, fmt.Sprintf("Entry %s not found", *s.leafID))
		}
	}
	return copyEntryIDPtr(s.leafID), nil
}

func (s *InMemorySessionStorage) SetLeafID(leafID *EntryID) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if leafID != nil {
		if _, ok := s.byID[*leafID]; !ok {
			return sessionError(ErrorNotFound, fmt.Sprintf("Entry %s not found", *leafID))
		}
	}

	entry := SessionEntry{
		Type:      "leaf",
		ID:        s.createEntryIDLocked(),
		ParentID:  copyEntryIDPtr(s.leafID),
		Timestamp: newTimestamp(),
		TargetID:  copyEntryIDPtr(leafID),
	}
	s.entries = append(s.entries, entry)
	s.byID[entry.ID] = len(s.entries) - 1
	s.leafID = copyEntryIDPtr(leafID)
	return nil
}

func (s *InMemorySessionStorage) CreateEntryID() EntryID {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.createEntryIDLocked()
}

func (s *InMemorySessionStorage) AppendEntry(entry SessionEntry) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.entries = append(s.entries, entry)
	s.byID[entry.ID] = len(s.entries) - 1
	updateLabelCache(s.labels, entry)
	s.leafID = leafIDAfterEntry(entry)
	return nil
}

func (s *InMemorySessionStorage) GetEntry(id EntryID) (SessionEntry, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	index, ok := s.byID[id]
	if !ok {
		return SessionEntry{}, false
	}
	return s.entries[index], true
}

func (s *InMemorySessionStorage) FindEntries(entryType string) []SessionEntry {
	s.mu.Lock()
	defer s.mu.Unlock()

	entries := []SessionEntry{}
	for _, entry := range s.entries {
		if entry.Type == entryType {
			entries = append(entries, entry)
		}
	}
	return entries
}

func (s *InMemorySessionStorage) GetLabel(id EntryID) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	label, ok := s.labels[id]
	return label, ok
}

func (s *InMemorySessionStorage) GetPathToRoot(leafID *EntryID) ([]SessionEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if leafID == nil {
		return []SessionEntry{}, nil
	}
	currentID := *leafID
	path := []SessionEntry{}
	for {
		index, ok := s.byID[currentID]
		if !ok {
			return nil, sessionError(ErrorNotFound, fmt.Sprintf("Entry %s not found", currentID))
		}
		current := s.entries[index]
		path = append(path, current)
		if current.ParentID == nil {
			break
		}
		parentID := *current.ParentID
		if _, ok := s.byID[parentID]; !ok {
			return nil, sessionError(ErrorInvalidSession, fmt.Sprintf("Entry %s not found", parentID))
		}
		currentID = parentID
	}
	reverseEntries(path)
	return path, nil
}

func (s *InMemorySessionStorage) GetEntries() []SessionEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]SessionEntry(nil), s.entries...)
}

func (s *InMemorySessionStorage) createEntryIDLocked() EntryID {
	for range 100 {
		id := EntryID(newRandomID()[:8])
		if _, ok := s.byID[id]; !ok {
			return id
		}
	}
	return EntryID(newRandomID())
}
