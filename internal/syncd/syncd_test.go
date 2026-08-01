// Input: internal/db, internal/db/postgres/sqlc, internal/store, loro-protocol-go, coder/websocket
// Output: test suite
// Pos: Test code
//
// 🔄 Self-reference: When this file changes, update this header

package syncd

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	lp "github.com/cunninghamcard-bit/loro-protocol-go"

	"github.com/cunninghamcard-bit/Attention/internal/db"
	"github.com/cunninghamcard-bit/Attention/internal/db/postgres/sqlc"
	"github.com/cunninghamcard-bit/Attention/internal/store"
)

// The transport in these tests is real (httptest + WebSocket) and the codec
// is the conformance-proven one, so what is under test is the engine:
// rooms, backfill, acks, broadcast, fragments. Auth is a fake — the JWT
// authorizer is S4's. Same TEST_DATABASE_URL gating as internal/store.

type fakeAuth struct{}

func (fakeAuth) Authorize(_ context.Context, auth []byte, _ string) (lp.Permission, error) {
	switch string(auth) {
	case "writer":
		return lp.PermissionWrite, nil
	case "reader":
		return lp.PermissionRead, nil
	default:
		return 0, errors.New("bad token")
	}
}

type harness struct {
	t      *testing.T
	store  *store.Store
	server *Server
	url    string
	vault  string
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; start devenv/docker-compose.yml to run syncd tests")
	}
	if _, err := db.Migrate(dsn, []string{"up"}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	pool, err := db.Connect(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(context.Background(), "TRUNCATE users CASCADE"); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	q := sqlc.New(pool)
	user, err := q.CreateUser(context.Background(), sqlc.CreateUserParams{
		Email: fmt.Sprintf("%s@test.local", strings.ReplaceAll(t.Name(), "/", "_")), PassHash: "x",
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	vault, err := q.CreateVault(context.Background(), sqlc.CreateVaultParams{OwnerID: user.ID, Name: "v"})
	if err != nil {
		t.Fatalf("create vault: %v", err)
	}

	st := store.New(pool)
	srv := New(st, fakeAuth{}, slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError})))
	ts := httptest.NewServer(srv)
	t.Cleanup(ts.Close)
	return &harness{
		t: t, store: st, server: srv,
		url:   "ws" + strings.TrimPrefix(ts.URL, "http"),
		vault: vault.ID,
	}
}

func (h *harness) room(doc string) string { return h.vault + "/" + doc }

type client struct {
	t  *testing.T
	ws *websocket.Conn
}

func (h *harness) dial() *client {
	h.t.Helper()
	ws, _, err := websocket.Dial(context.Background(), h.url, nil)
	if err != nil {
		h.t.Fatalf("dial: %v", err)
	}
	ws.SetReadLimit(272 * 1024)
	h.t.Cleanup(func() { _ = ws.CloseNow() })
	return &client{t: h.t, ws: ws}
}

func (c *client) send(msg lp.Message) {
	c.t.Helper()
	data, err := lp.Encode(msg)
	if err != nil {
		c.t.Fatalf("encode: %v", err)
	}
	if err := c.ws.Write(context.Background(), websocket.MessageBinary, data); err != nil {
		c.t.Fatalf("write: %v", err)
	}
}

func (c *client) recv() lp.Message {
	c.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	typ, data, err := c.ws.Read(ctx)
	if err != nil {
		c.t.Fatalf("read: %v", err)
	}
	if typ != websocket.MessageBinary {
		c.t.Fatalf("unexpected frame type %v (%q)", typ, data)
	}
	msg, err := lp.Decode(data)
	if err != nil {
		c.t.Fatalf("decode: %v", err)
	}
	return msg
}

func (c *client) join(room, auth string) *lp.JoinResponseOk {
	c.t.Helper()
	c.send(&lp.JoinRequest{
		Envelope: lp.Envelope{Crdt: lp.CrdtLoro, RoomID: room}, Auth: []byte(auth),
	})
	msg := c.recv()
	ok, isOk := msg.(*lp.JoinResponseOk)
	if !isOk {
		c.t.Fatalf("join answered %T: %+v", msg, msg)
	}
	return ok
}

// recvPayloads collects DocUpdate payloads (reassembling fragments) until
// `want` have arrived.
func (c *client) recvPayloads(want int) [][]byte {
	c.t.Helper()
	var out [][]byte
	frags := map[lp.BatchID]*struct {
		total uint64
		count uint64
		parts map[uint64][]byte
	}{}
	for len(out) < want {
		switch m := c.recv().(type) {
		case *lp.DocUpdate:
			out = append(out, m.Updates...)
		case *lp.DocUpdateFragmentHeader:
			frags[m.BatchID] = &struct {
				total uint64
				count uint64
				parts map[uint64][]byte
			}{total: m.TotalSize, count: m.FragmentCount, parts: map[uint64][]byte{}}
		case *lp.DocUpdateFragment:
			b := frags[m.BatchID]
			if b == nil {
				c.t.Fatalf("fragment for unknown batch")
			}
			b.parts[m.Index] = append([]byte(nil), m.Fragment...)
			if uint64(len(b.parts)) == b.count {
				var joined []byte
				for i := uint64(0); i < b.count; i++ {
					joined = append(joined, b.parts[i]...)
				}
				if uint64(len(joined)) != b.total {
					c.t.Fatalf("reassembled %d bytes, want %d", len(joined), b.total)
				}
				out = append(out, joined)
				delete(frags, m.BatchID)
			}
		default:
			c.t.Fatalf("unexpected message %T", m)
		}
	}
	return out
}

// recvUntilContains reads until every wanted payload has been seen at least
// once (duplicates tolerated — the transport is at-least-once).
func (c *client) recvUntilContains(want [][]byte) {
	c.t.Helper()
	remaining := make(map[string]bool, len(want))
	for _, w := range want {
		remaining[string(w)] = true
	}
	for guard := 0; len(remaining) > 0 && guard < 32; guard++ {
		for _, payload := range c.recvPayloads(1) {
			delete(remaining, string(payload))
		}
	}
	if len(remaining) > 0 {
		c.t.Fatalf("payloads never arrived: %d missing", len(remaining))
	}
}

func env(room string) lp.Envelope { return lp.Envelope{Crdt: lp.CrdtLoro, RoomID: room} }

func TestJoinBackfillsSnapshotThenLog(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	for i := 1; i <= 3; i++ {
		if _, err := h.store.AppendUpdate(ctx, h.vault, "doc", int16(lp.CrdtLoro), []byte{byte(i)}); err != nil {
			t.Fatal(err)
		}
	}
	if err := h.store.CompactRoom(ctx, h.vault, "doc", int16(lp.CrdtLoro), []byte("SNAP"), 2); err != nil {
		t.Fatal(err)
	}

	c := h.dial()
	ok := c.join(h.room("doc"), "writer")
	if ok.Permission != lp.PermissionWrite || len(ok.Version) != 0 {
		t.Fatalf("join response: %+v", ok)
	}
	payloads := c.recvPayloads(2)
	if string(payloads[0]) != "SNAP" || !bytes.Equal(payloads[1], []byte{3}) {
		t.Fatalf("backfill wrong: %q", payloads)
	}
}

func TestJoinRejectsBadAuthAndBadRoomID(t *testing.T) {
	h := newHarness(t)
	c := h.dial()
	c.send(&lp.JoinRequest{Envelope: env(h.room("doc")), Auth: []byte("nope")})
	if m, ok := c.recv().(*lp.JoinError); !ok || m.Code != lp.JoinErrAuthFailed {
		t.Fatalf("want auth_failed, got %+v", m)
	}
	c.send(&lp.JoinRequest{Envelope: env("no-slash-here"), Auth: []byte("writer")})
	if m, ok := c.recv().(*lp.JoinError); !ok || m.Code != lp.JoinErrUnknown {
		t.Fatalf("want unknown join error, got %+v", m)
	}
}

func TestUpdateIsStoredAckedAndBroadcast(t *testing.T) {
	h := newHarness(t)
	a, b := h.dial(), h.dial()
	a.join(h.room("doc"), "writer")
	b.join(h.room("doc"), "writer")

	batch := lp.BatchID{9, 9, 9, 9, 9, 9, 9, 9}
	a.send(&lp.DocUpdate{Envelope: env(h.room("doc")), Updates: [][]byte{{1, 1}, {2}}, BatchID: batch})

	if ack, ok := a.recv().(*lp.Ack); !ok || ack.Status != lp.StatusOk || ack.RefID != batch {
		t.Fatalf("want ok ack for batch, got %+v", ack)
	}
	// Delivery is at-least-once BY DESIGN: join registers the peer before
	// the backfill read (the reverse order would LOSE updates committed in
	// between), so a concurrent push can arrive via both backfill and
	// broadcast. Idempotent client import absorbs duplicates; the assertion
	// here is containment, not exact sequence.
	b.recvUntilContains([][]byte{{1, 1}, {2}})
	// Persistence, by contrast, is strictly exactly-once.
	state, err := h.store.RoomStateSince(context.Background(), h.vault, "doc", int16(lp.CrdtLoro), 0)
	if err != nil || len(state.Log) != 2 {
		t.Fatalf("store must hold exactly two updates: %+v %v", state.Log, err)
	}

	// Late joiner gets the same data from storage, not from luck.
	late := h.dial()
	late.join(h.room("doc"), "reader")
	replay := late.recvPayloads(2)
	if !bytes.Equal(replay[0], []byte{1, 1}) || !bytes.Equal(replay[1], []byte{2}) {
		t.Fatalf("late backfill wrong: %v", replay)
	}
}

func TestReadPermissionCannotWrite(t *testing.T) {
	h := newHarness(t)
	r, w := h.dial(), h.dial()
	if ok := r.join(h.room("doc"), "reader"); ok.Permission != lp.PermissionRead {
		t.Fatalf("want read permission, got %+v", ok)
	}
	w.join(h.room("doc"), "writer")

	batch := lp.BatchID{1}
	r.send(&lp.DocUpdate{Envelope: env(h.room("doc")), Updates: [][]byte{{7}}, BatchID: batch})
	if ack, ok := r.recv().(*lp.Ack); !ok || ack.Status != lp.StatusPermissionDenied {
		t.Fatalf("want permission_denied, got %+v", ack)
	}
	// Nothing stored, nothing broadcast: the writer pushes next and the
	// reader's rejected byte never shows up anywhere.
	w.send(&lp.DocUpdate{Envelope: env(h.room("doc")), Updates: [][]byte{{8}}, BatchID: lp.BatchID{2}})
	if ack, ok := w.recv().(*lp.Ack); !ok || ack.Status != lp.StatusOk {
		t.Fatalf("writer ack: %+v", ack)
	}
	if got := r.recvPayloads(1); !bytes.Equal(got[0], []byte{8}) {
		t.Fatalf("reader received %v, want only the writer's byte", got)
	}
	state, err := h.store.RoomStateSince(context.Background(), h.vault, "doc", int16(lp.CrdtLoro), 0)
	if err != nil || len(state.Log) != 1 {
		t.Fatalf("store must hold exactly the writer's update: %+v %v", state.Log, err)
	}
}

func TestClientFragmentsReassembleToOnePayload(t *testing.T) {
	h := newHarness(t)
	a, b := h.dial(), h.dial()
	a.join(h.room("doc"), "writer")
	b.join(h.room("doc"), "writer")

	payload := bytes.Repeat([]byte{0xAB}, 1000)
	batch := lp.BatchID{5, 5, 5, 5, 5, 5, 5, 5}
	a.send(&lp.DocUpdateFragmentHeader{
		Envelope: env(h.room("doc")), BatchID: batch, FragmentCount: 3, TotalSize: 1000,
	})
	for i, bounds := range [][2]int{{0, 400}, {400, 800}, {800, 1000}} {
		a.send(&lp.DocUpdateFragment{
			Envelope: env(h.room("doc")), BatchID: batch, Index: uint64(i),
			Fragment: payload[bounds[0]:bounds[1]],
		})
	}
	if ack, ok := a.recv().(*lp.Ack); !ok || ack.Status != lp.StatusOk || ack.RefID != batch {
		t.Fatalf("want ok ack referencing the header batch, got %+v", ack)
	}
	if got := b.recvPayloads(1); !bytes.Equal(got[0], payload) {
		t.Fatalf("peer got %d bytes, want the reassembled 1000", len(got[0]))
	}
}

func TestFragmentTimeoutAcksAndDiscards(t *testing.T) {
	h := newHarness(t)
	h.server.ReassemblyTimeout = 50 * time.Millisecond
	a := h.dial()
	a.join(h.room("doc"), "writer")

	batch := lp.BatchID{6}
	a.send(&lp.DocUpdateFragmentHeader{
		Envelope: env(h.room("doc")), BatchID: batch, FragmentCount: 2, TotalSize: 10,
	})
	a.send(&lp.DocUpdateFragment{Envelope: env(h.room("doc")), BatchID: batch, Index: 0, Fragment: []byte{1, 2, 3, 4, 5}})

	if ack, ok := a.recv().(*lp.Ack); !ok || ack.Status != lp.StatusFragmentTimeout || ack.RefID != batch {
		t.Fatalf("want fragment_timeout, got %+v", ack)
	}
	state, err := h.store.RoomStateSince(context.Background(), h.vault, "doc", int16(lp.CrdtLoro), 0)
	if err != nil || len(state.Log) != 0 {
		t.Fatalf("half a batch must store nothing: %+v %v", state.Log, err)
	}
}

func TestOversizedBackfillArrivesFragmented(t *testing.T) {
	h := newHarness(t)
	big := bytes.Repeat([]byte{0xCD}, 500_000) // two fragments' worth
	if _, err := h.store.AppendUpdate(context.Background(), h.vault, "doc", int16(lp.CrdtLoro), big); err != nil {
		t.Fatal(err)
	}
	c := h.dial()
	c.join(h.room("doc"), "reader")
	got := c.recvPayloads(1)
	if !bytes.Equal(got[0], big) {
		t.Fatalf("oversized backfill corrupted: %d bytes", len(got[0]))
	}
}

func TestKeepalivePingPong(t *testing.T) {
	h := newHarness(t)
	c := h.dial()
	if err := c.ws.Write(context.Background(), websocket.MessageText, []byte("ping")); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	typ, data, err := c.ws.Read(ctx)
	if err != nil || typ != websocket.MessageText || string(data) != "pong" {
		t.Fatalf("want text pong, got %v %q %v", typ, data, err)
	}
}
