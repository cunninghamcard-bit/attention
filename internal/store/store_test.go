// Input: internal/db, internal/db/postgres/sqlc
// Output: test suite
// Pos: Test code
//
// 🔄 Self-reference: When this file changes, update this header

package store

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cunninghamcard-bit/Attention/internal/db"
	"github.com/cunninghamcard-bit/Attention/internal/db/postgres/sqlc"
)

// Integration tests against real Postgres (the Memoh TEST_DATABASE_URL
// pattern): set TEST_DATABASE_URL to run, e.g. the devenv compose instance
//   postgres://attention:attention@127.0.0.1:5433/attention?sslmode=disable
// Absent, the suite skips — a replayed green is not a green, but a suite
// that fails without infrastructure is noise.

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; start devenv/docker-compose.yml to run storage tests")
	}
	if _, err := db.Migrate(dsn, []string{"up"}); err != nil {
		t.Fatalf("migrate up: %v", err)
	}
	pool, err := db.Connect(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	// Every table cascades from users; truncating it resets the world.
	if _, err := pool.Exec(context.Background(), "TRUNCATE users CASCADE"); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	return pool
}

// fixtureVault creates the user+vault rows the data plane's foreign keys
// require, returning the vault id.
func fixtureVault(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	q := sqlc.New(pool)
	ctx := context.Background()
	user, err := q.CreateUser(ctx, sqlc.CreateUserParams{
		Email: fmt.Sprintf("%s@test.local", t.Name()), PassHash: "x",
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	vault, err := q.CreateVault(ctx, sqlc.CreateVaultParams{OwnerID: user.ID, Name: "v"})
	if err != nil {
		t.Fatalf("create vault: %v", err)
	}
	return vault.ID
}

func TestAppendAssignsDenseOrderAndScanReplays(t *testing.T) {
	pool := testPool(t)
	vault := fixtureVault(t, pool)
	s := New(pool)
	ctx := context.Background()

	for i, payload := range [][]byte{{1}, {2, 2}, {3}} {
		n, err := s.AppendUpdate(ctx, vault, "doc-1", 0, payload)
		if err != nil {
			t.Fatalf("append %d: %v", i, err)
		}
		if n != int64(i+1) {
			t.Fatalf("append %d: n=%d, want %d", i, n, i+1)
		}
	}

	state, err := s.RoomStateSince(ctx, vault, "doc-1", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if state.Snapshot != nil || len(state.Log) != 3 {
		t.Fatalf("state: snapshot=%v log=%d", state.Snapshot, len(state.Log))
	}
	if !bytes.Equal(state.Log[1].Bytes, []byte{2, 2}) || state.Log[2].N != 3 {
		t.Fatalf("log content wrong: %+v", state.Log)
	}

	// The cursor is exclusive: after the second entry, only the third comes.
	tail, err := s.RoomStateSince(ctx, vault, "doc-1", 0, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(tail.Log) != 1 || tail.Log[0].N != 3 {
		t.Fatalf("tail wrong: %+v", tail.Log)
	}

	// Same room id, different CRDT type = a different room (protocol.md).
	other, err := s.RoomStateSince(ctx, vault, "doc-1", 1, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(other.Log) != 0 {
		t.Fatalf("crdt_type must partition rooms, got %d entries", len(other.Log))
	}
}

func TestConcurrentAppendsNeverCollide(t *testing.T) {
	pool := testPool(t)
	vault := fixtureVault(t, pool)
	s := New(pool)
	const writers, each = 8, 5

	var wg sync.WaitGroup
	errs := make(chan error, writers*each)
	for w := 0; w < writers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < each; i++ {
				if _, err := s.AppendUpdate(context.Background(), vault, "hot", 0, []byte{byte(i)}); err != nil {
					errs <- err
				}
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}

	state, err := s.RoomStateSince(context.Background(), vault, "hot", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Log) != writers*each {
		t.Fatalf("lost writes: %d/%d", len(state.Log), writers*each)
	}
	// The room-row lock serializes n assignment: dense 1..N, no collisions.
	for i, u := range state.Log {
		if u.N != int64(i+1) {
			t.Fatalf("n sequence broken at %d: %d", i, u.N)
		}
	}
}

func TestCompactionKeepsTheTailAndOldCursorsGetSnapshot(t *testing.T) {
	pool := testPool(t)
	vault := fixtureVault(t, pool)
	s := New(pool)
	ctx := context.Background()

	for i := 1; i <= 5; i++ {
		if _, err := s.AppendUpdate(ctx, vault, "doc", 0, []byte{byte(i)}); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.CompactRoom(ctx, vault, "doc", 0, []byte("SNAP"), 3); err != nil {
		t.Fatal(err)
	}

	// A fresh client: snapshot + the surviving tail (4, 5).
	state, err := s.RoomStateSince(ctx, vault, "doc", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if string(state.Snapshot) != "SNAP" || len(state.Log) != 2 || state.Log[0].N != 4 {
		t.Fatalf("post-compact state wrong: snap=%q log=%+v", state.Snapshot, state.Log)
	}

	// An old cursor inside the compacted range gets the snapshot too — the
	// spec's "compaction can swallow updates an old cursor never saw" rule
	// is satisfied by always returning the snapshot alongside the tail.
	old, err := s.RoomStateSince(ctx, vault, "doc", 0, 2)
	if err != nil {
		t.Fatal(err)
	}
	if string(old.Snapshot) != "SNAP" || len(old.Log) != 2 {
		t.Fatalf("old cursor state wrong: snap=%q log=%+v", old.Snapshot, old.Log)
	}

	// Compacting a room that does not exist is an error, not a silent no-op.
	if err := s.CompactRoom(ctx, vault, "ghost", 0, []byte("S"), 1); err == nil {
		t.Fatal("want error compacting nonexistent room")
	}
}

func TestUnknownRoomIsEmptyNotError(t *testing.T) {
	pool := testPool(t)
	vault := fixtureVault(t, pool)
	state, err := New(pool).RoomStateSince(context.Background(), vault, "never-seen", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if state.Snapshot != nil || len(state.Log) != 0 {
		t.Fatalf("want empty state, got %+v", state)
	}
}

func TestBlobsDedupByHash(t *testing.T) {
	pool := testPool(t)
	vault := fixtureVault(t, pool)
	s := New(pool)
	ctx := context.Background()

	if err := s.PutBlob(ctx, vault, "h1", []byte("attachment")); err != nil {
		t.Fatal(err)
	}
	// Same hash again: no-op, no error.
	if err := s.PutBlob(ctx, vault, "h1", []byte("attachment")); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetBlob(ctx, vault, "h1")
	if err != nil || string(got) != "attachment" {
		t.Fatalf("get: %q %v", got, err)
	}
	if _, err := s.GetBlob(ctx, vault, "absent"); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("want ErrNoRows, got %v", err)
	}
}
