package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/cunninghamcard-bit/Attention/internal/session"
)

// sessionFlags holds the parsed session-selection CLI flags, ported from pi's
// session flags (main.ts createSessionManager) and adapted for the headless
// kernel.
//
// Headless adaptations vs pi:
//   - --resume has no interactive picker (that is a frontend concern), so it
//     degrades to "resume the most recent session" — identical to --continue.
//   - There is no interactive "fork into current dir" prompt; a resumed session
//     keeps its own recorded CWD.
type sessionFlags struct {
	session   string // --session <path-or-id>: resume a specific session
	cont      bool   // --continue: resume the most recent session for this cwd
	resume    bool   // --resume: headless => most recent session (see above)
	sessionID string // --session-id <id>: resume-or-create a session with this id
	noSession bool   // --no-session: ephemeral, non-persisted session
	fork      string // --fork <path-or-id>: fork a source session into a NEW session
}

// sessionPlanKind selects which orchestrator constructor path a resolved plan
// takes.
type sessionPlanKind int

const (
	// planNew creates a fresh persisted session via orchestrator.New +
	// repo.Create (CreateOptions carries an optional ID).
	planNew sessionPlanKind = iota
	// planOpen resumes an existing persisted session via orchestrator.Open +
	// repo.Open(Metadata).
	planOpen
	// planEphemeral builds an in-memory session and passes it as opts.Session to
	// orchestrator.New, which then skips repo.Create. Nothing is persisted.
	planEphemeral
	// planFork creates a fresh persisted session whose header records a parent
	// session path (CreateOptions.ParentSessionPath), forking from a source
	// session selected by --fork.
	planFork
)

// sessionPlan is the resolved decision: which constructor to call and with what
// inputs. cwd is the effective CWD for context-file loading / system prompt; for
// a resumed session it is the session's recorded CWD (which may differ from the
// process cwd), for everything else it is the process cwd.
type sessionPlan struct {
	kind          sessionPlanKind
	createOptions session.JsonlSessionCreateOptions // planNew
	metadata      session.Metadata                  // planOpen
	ephemeral     *session.Session                  // planEphemeral
	cwd           string
}

// validateSessionFlags mirrors pi's validateSessionIdFlags and rejects
// conflicting combinations.
//
// Rules:
//   - --session-id cannot be combined with --session, --continue, --resume, or
//     --no-session (pi: session-id owns the whole selection decision).
//   - --no-session cannot be combined with any session-selection flag
//     (--session, --continue, --resume), since an ephemeral session cannot also
//     resume a persisted one.
//   - --session, --continue, and --resume are mutually exclusive selectors.
//   - --fork creates a brand-new session forked from a source; it cannot be
//     combined with any session-resume/-selection flag.
func validateSessionFlags(f sessionFlags) error {
	// selectors are the resume/select flags, in precedence order. Each owning
	// flag below forbids being combined with any of these that is set.
	selectors := []struct {
		name string
		set  bool
	}{
		{"--session", f.session != ""},
		{"--continue", f.cont},
		{"--resume", f.resume},
		{"--session-id", f.sessionID != ""},
		{"--no-session", f.noSession},
	}

	// conflictsWith reports the names of the selector flags (other than `owner`)
	// that are set, so an owning flag can list what it collides with.
	conflictsWith := func(owner string) []string {
		var conflicts []string
		for _, s := range selectors {
			if s.name == owner {
				continue
			}
			if s.set {
				conflicts = append(conflicts, s.name)
			}
		}
		return conflicts
	}

	if f.fork != "" {
		if conflicts := conflictsWith(""); len(conflicts) > 0 {
			return fmt.Errorf("--fork cannot be combined with %s", strings.Join(conflicts, ", "))
		}
	}

	if f.sessionID != "" {
		if conflicts := conflictsWith("--session-id"); len(conflicts) > 0 {
			return fmt.Errorf("--session-id cannot be combined with %s", strings.Join(conflicts, ", "))
		}
	}

	if f.noSession {
		if conflicts := conflictsWith("--no-session"); len(conflicts) > 0 {
			return fmt.Errorf("--no-session cannot be combined with %s", strings.Join(conflicts, ", "))
		}
	}

	// --session, --continue, --resume select a single target; only one may win.
	var exclusive []string
	for _, name := range []string{"--session", "--continue", "--resume"} {
		for _, s := range selectors {
			if s.name == name && s.set {
				exclusive = append(exclusive, name)
			}
		}
	}
	if len(exclusive) > 1 {
		return fmt.Errorf("%s are mutually exclusive", strings.Join(exclusive, ", "))
	}

	return nil
}

// sessionLister is the subset of the repo used to resolve session targets. It is
// satisfied by *session.JsonlSessionRepo and stubbable in tests.
type sessionLister interface {
	List(ctx context.Context, opts ...session.JsonlSessionListOptions) ([]session.Metadata, error)
}

// resolveSessionPlan turns the validated flags into a concrete build plan. It
// performs the List/path lookups needed to locate a resumable session but does
// not open or create anything — that is the caller's job, so the constructor
// choice stays in main.go.
//
// Precedence (highest first): --no-session, --session-id, --session,
// --continue, --resume. The validation above guarantees at most one of these is
// actually set in a conflicting way, so precedence only orders the
// non-conflicting single-flag cases.
func resolveSessionPlan(
	ctx context.Context,
	repo sessionLister,
	cwd string,
	f sessionFlags,
) (sessionPlan, error) {
	switch {
	case f.fork != "":
		// Resolve the source session (path or id) and create a fresh persisted
		// session whose header records the source path as its parent. The fork
		// starts in the process cwd, mirroring "fork into a new session".
		src, err := resolveSessionTarget(ctx, repo, cwd, f.fork)
		if err != nil {
			return sessionPlan{}, err
		}
		return sessionPlan{
			kind: planFork,
			createOptions: session.JsonlSessionCreateOptions{
				CWD:               cwd,
				ParentSessionPath: src.Path,
			},
			cwd: cwd,
		}, nil

	case f.noSession:
		return sessionPlan{
			kind:      planEphemeral,
			ephemeral: session.NewInMemorySession(cwd),
			cwd:       cwd,
		}, nil

	case f.sessionID != "":
		// Resume-or-create by exact id: open it if a local session already has
		// this id, otherwise create a new one with the id.
		meta, ok, err := findSessionByID(ctx, repo, cwd, f.sessionID, false)
		if err != nil {
			return sessionPlan{}, err
		}
		if ok {
			return sessionPlan{kind: planOpen, metadata: meta, cwd: meta.CWD}, nil
		}
		return sessionPlan{
			kind:          planNew,
			createOptions: session.JsonlSessionCreateOptions{ID: f.sessionID, CWD: cwd},
			cwd:           cwd,
		}, nil

	case f.session != "":
		meta, err := resolveSessionTarget(ctx, repo, cwd, f.session)
		if err != nil {
			return sessionPlan{}, err
		}
		return sessionPlan{kind: planOpen, metadata: meta, cwd: meta.CWD}, nil

	case f.cont:
		meta, err := mostRecentSession(ctx, repo, cwd)
		if err != nil {
			return sessionPlan{}, err
		}
		return sessionPlan{kind: planOpen, metadata: meta, cwd: meta.CWD}, nil

	case f.resume:
		// Headless has no interactive session picker (pi's --resume opens one);
		// the picker is a frontend concern. We degrade --resume to "resume the
		// most recent session", identical to --continue.
		meta, err := mostRecentSession(ctx, repo, cwd)
		if err != nil {
			return sessionPlan{}, err
		}
		return sessionPlan{kind: planOpen, metadata: meta, cwd: meta.CWD}, nil

	default:
		// No session flag: fresh persisted session (the pre-existing behavior).
		return sessionPlan{
			kind:          planNew,
			createOptions: session.JsonlSessionCreateOptions{CWD: cwd},
			cwd:           cwd,
		}, nil
	}
}

// resolveSessionTarget resolves a --session value. If it is an existing file
// path, it is used directly as Metadata.Path. Otherwise it is treated as a
// session id and matched (exact or unambiguous prefix) against the listed
// sessions for the cwd, falling back to a full listing if not found there.
func resolveSessionTarget(
	ctx context.Context,
	repo sessionLister,
	cwd string,
	value string,
) (session.Metadata, error) {
	if isExistingFile(value) {
		return session.Metadata{Path: value}, nil
	}
	meta, ok, err := findSessionByID(ctx, repo, cwd, value, true)
	if err != nil {
		return session.Metadata{}, err
	}
	if !ok {
		return session.Metadata{}, fmt.Errorf("no session found matching %q (not a file path or known session id)", value)
	}
	return meta, nil
}

// findSessionByID looks up a session by id. When allowPrefix is true an
// unambiguous prefix match is accepted; an ambiguous prefix is an error. It
// searches the cwd's sessions first, then the full session root, so a session
// recorded under a different cwd is still found.
func findSessionByID(
	ctx context.Context,
	repo sessionLister,
	cwd string,
	id string,
	allowPrefix bool,
) (session.Metadata, bool, error) {
	scoped, err := repo.List(ctx, session.JsonlSessionListOptions{CWD: cwd})
	if err != nil {
		return session.Metadata{}, false, err
	}
	if meta, ok, err := matchSessionID(scoped, id, allowPrefix); ok || err != nil {
		return meta, ok, err
	}

	all, err := repo.List(ctx)
	if err != nil {
		return session.Metadata{}, false, err
	}
	return matchSessionID(all, id, allowPrefix)
}

// matchSessionID finds a session by exact id, or by unambiguous prefix when
// allowPrefix is set. It returns an error for an ambiguous prefix.
func matchSessionID(
	sessions []session.Metadata,
	id string,
	allowPrefix bool,
) (session.Metadata, bool, error) {
	for _, meta := range sessions {
		if meta.ID == id {
			return meta, true, nil
		}
	}
	if !allowPrefix || id == "" {
		return session.Metadata{}, false, nil
	}

	var matches []session.Metadata
	for _, meta := range sessions {
		if strings.HasPrefix(meta.ID, id) {
			matches = append(matches, meta)
		}
	}
	switch len(matches) {
	case 0:
		return session.Metadata{}, false, nil
	case 1:
		return matches[0], true, nil
	default:
		ids := make([]string, 0, len(matches))
		for _, meta := range matches {
			ids = append(ids, meta.ID)
		}
		return session.Metadata{}, false, fmt.Errorf("session id prefix %q is ambiguous (matches %s)", id, strings.Join(ids, ", "))
	}
}

// mostRecentSession returns the newest session for cwd by Modified time. The
// repo already returns List results newest-first (internal/session/repo.go
// sorts by Modified descending), so the first element is the most recent.
func mostRecentSession(
	ctx context.Context,
	repo sessionLister,
	cwd string,
) (session.Metadata, error) {
	sessions, err := repo.List(ctx, session.JsonlSessionListOptions{CWD: cwd})
	if err != nil {
		return session.Metadata{}, err
	}
	if len(sessions) == 0 {
		return session.Metadata{}, fmt.Errorf("no session to continue for %s", cwd)
	}
	return sessions[0], nil
}

// isExistingFile reports whether value names an existing regular file.
func isExistingFile(value string) bool {
	info, err := os.Stat(value)
	return err == nil && !info.IsDir()
}
