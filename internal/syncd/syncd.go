// Input: coder/websocket, loro-protocol-go, internal/store
// Output: Server, Authorizer, Permission handling for loro-protocol rooms
// Pos: Server sync engine
//
// 🔄 Self-reference: When this file changes, update this header

// Package syncd is the loro-protocol sync engine behind /sync: rooms,
// backfill, broadcast, fragment reassembly. It stores and forwards opaque
// payloads only — no loro dependency, ever (the spec's server invariant).
//
// Wire room ids are "<vaultID>/<docID>"; the vault half is what the
// Authorizer rules on, the doc half is the store's room key. Fragment
// semantics mirror the official client exactly: a reassembled batch is ONE
// update payload, acked by the header's batch id, and a fresh header for a
// known batch id evicts the old attempt with a fragment_timeout Ack.
package syncd

import (
	"context"
	"crypto/rand"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	lp "github.com/cunninghamcard-bit/loro-protocol-go"

	"github.com/cunninghamcard-bit/Attention/internal/store"
)

// Authorizer decides what a join payload may do in a vault. S4 supplies the
// JWT implementation; tests inject fakes.
type Authorizer interface {
	Authorize(ctx context.Context, auth []byte, vaultID string) (lp.Permission, error)
}

const (
	// fragLimit matches the official client: stay under the 256 KiB frame
	// cap with envelope headroom.
	fragLimit = 240 * 1024
	// maxUpdateSize caps a reassembled payload; snapshots are the biggest
	// legitimate updates. ponytail: 64 MiB guardrail, revisit with real data.
	maxUpdateSize = 64 << 20
)

type roomKey struct {
	vaultID string
	roomID  string
	crdt    lp.CrdtType
}

// splitRoomID parses the wire form "<vaultID>/<docID>".
func splitRoomID(wire string) (vaultID, docID string, ok bool) {
	vaultID, docID, ok = strings.Cut(wire, "/")
	return vaultID, docID, ok && vaultID != "" && docID != ""
}

type Server struct {
	store  *store.Store
	auth   Authorizer
	logger *slog.Logger
	// ReassemblyTimeout guards half-received fragment batches (protocol
	// default 10s); tests shrink it.
	ReassemblyTimeout time.Duration

	mu    sync.Mutex
	rooms map[roomKey]map[*conn]lp.Permission
}

func New(st *store.Store, auth Authorizer, logger *slog.Logger) *Server {
	return &Server{
		store:             st,
		auth:              auth,
		logger:            logger,
		ReassemblyTimeout: 10 * time.Second,
		rooms:             map[roomKey]map[*conn]lp.Permission{},
	}
}

// conn is one WebSocket peer: its write lock, joined rooms, and in-flight
// fragment batches.
type conn struct {
	ws      *websocket.Conn
	writeMu sync.Mutex

	mu     sync.Mutex
	joined map[roomKey]lp.Permission
	frags  map[fragKey]*pendingBatch
}

type fragKey struct {
	room  roomKey
	batch lp.BatchID
}

type pendingBatch struct {
	total     uint64
	count     uint64
	fragments map[uint64][]byte
	received  uint64
	timer     *time.Timer
}

// ServeHTTP upgrades and runs the read loop until the peer goes away.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// Origin policy is the HTTP shell's concern (S3 wires it); the
		// engine accepts what it is handed.
		InsecureSkipVerify: true,
	})
	if err != nil {
		return
	}
	// Frames above the protocol's 256 KiB cap (plus slack) are a violation.
	ws.SetReadLimit(272 * 1024)
	c := &conn{ws: ws, joined: map[roomKey]lp.Permission{}, frags: map[fragKey]*pendingBatch{}}
	defer s.drop(c)
	ctx := r.Context()
	for {
		typ, data, err := ws.Read(ctx)
		if err != nil {
			return
		}
		if typ == websocket.MessageText {
			if lp.IsKeepalive(string(data)) && string(data) == lp.KeepalivePing {
				c.send(ctx, websocket.MessageText, []byte(lp.KeepalivePong))
			}
			continue
		}
		msg, err := lp.Decode(data)
		if err != nil {
			s.logger.Warn("protocol violation", slog.Any("error", err))
			continue
		}
		s.handle(ctx, c, msg)
	}
}

func (s *Server) handle(ctx context.Context, c *conn, msg lp.Message) {
	env := lp.EnvelopeOf(msg)
	vaultID, docID, ok := splitRoomID(env.RoomID)
	if !ok {
		s.sendMsg(ctx, c, &lp.JoinError{
			Envelope: env, Code: lp.JoinErrUnknown, Message: "room id must be <vault>/<doc>",
		})
		return
	}
	key := roomKey{vaultID: vaultID, roomID: docID, crdt: env.Crdt}

	switch m := msg.(type) {
	case *lp.JoinRequest:
		s.handleJoin(ctx, c, env, key, m)
	case *lp.DocUpdate:
		s.handleUpdate(ctx, c, env, key, m.BatchID, m.Updates)
	case *lp.DocUpdateFragmentHeader:
		s.handleFragmentHeader(c, env, key, m)
	case *lp.DocUpdateFragment:
		s.handleFragment(ctx, c, env, key, m)
	case *lp.Leave:
		s.unsubscribe(c, key)
	case *lp.Ack:
		// A client reporting it failed to apply a server batch: log only.
		if m.Status != lp.StatusOk {
			s.logger.Warn("client rejected update",
				slog.String("room", env.RoomID), slog.Int("status", int(m.Status)))
		}
	}
}

func (s *Server) handleJoin(ctx context.Context, c *conn, env lp.Envelope, key roomKey, m *lp.JoinRequest) {
	perm, err := s.auth.Authorize(ctx, m.Auth, key.vaultID)
	if err != nil {
		s.sendMsg(ctx, c, &lp.JoinError{
			Envelope: env, Code: lp.JoinErrAuthFailed, Message: "authorization failed",
		})
		return
	}

	s.mu.Lock()
	if s.rooms[key] == nil {
		s.rooms[key] = map[*conn]lp.Permission{}
	}
	s.rooms[key][c] = perm
	s.mu.Unlock()
	c.mu.Lock()
	c.joined[key] = perm
	c.mu.Unlock()

	// Empty server version: this server never interprets versions, it
	// backfills wholesale and lets idempotent import absorb the overlap.
	s.sendMsg(ctx, c, &lp.JoinResponseOk{Envelope: env, Permission: perm, Version: nil})

	state, err := s.store.RoomStateSince(ctx, key.vaultID, key.roomID, int16(key.crdt), 0)
	if err != nil {
		s.logger.Error("backfill read failed", slog.Any("error", err))
		return
	}
	var payloads [][]byte
	if len(state.Snapshot) > 0 {
		payloads = append(payloads, state.Snapshot)
	}
	for _, u := range state.Log {
		payloads = append(payloads, u.Bytes)
	}
	if len(payloads) > 0 {
		s.sendUpdates(ctx, c, env, payloads)
	}
}

func (s *Server) handleUpdate(ctx context.Context, c *conn, env lp.Envelope, key roomKey, batchID lp.BatchID, payloads [][]byte) {
	c.mu.Lock()
	perm, joined := c.joined[key]
	c.mu.Unlock()
	if !joined || perm != lp.PermissionWrite {
		s.sendMsg(ctx, c, &lp.Ack{Envelope: env, RefID: batchID, Status: lp.StatusPermissionDenied})
		return
	}
	for _, payload := range payloads {
		if _, err := s.store.AppendUpdate(ctx, key.vaultID, key.roomID, int16(key.crdt), payload); err != nil {
			s.logger.Error("append failed", slog.Any("error", err))
			s.sendMsg(ctx, c, &lp.Ack{Envelope: env, RefID: batchID, Status: lp.StatusUnknown})
			return
		}
	}
	s.sendMsg(ctx, c, &lp.Ack{Envelope: env, RefID: batchID, Status: lp.StatusOk})

	s.mu.Lock()
	peers := make([]*conn, 0, len(s.rooms[key]))
	for peer := range s.rooms[key] {
		if peer != c {
			peers = append(peers, peer)
		}
	}
	s.mu.Unlock()
	for _, peer := range peers {
		s.sendUpdates(ctx, peer, env, payloads)
	}
}

func (s *Server) handleFragmentHeader(c *conn, env lp.Envelope, key roomKey, m *lp.DocUpdateFragmentHeader) {
	if m.TotalSize > maxUpdateSize || m.FragmentCount == 0 {
		s.sendMsg(context.Background(), c, &lp.Ack{
			Envelope: env, RefID: m.BatchID, Status: lp.StatusPayloadTooLarge,
		})
		return
	}
	fk := fragKey{room: key, batch: m.BatchID}
	c.mu.Lock()
	// A repeated header evicts the old attempt — mirror the official
	// client: the stale batch dies with a fragment_timeout Ack.
	if old := c.frags[fk]; old != nil {
		old.timer.Stop()
		delete(c.frags, fk)
		s.sendMsg(context.Background(), c, &lp.Ack{
			Envelope: env, RefID: m.BatchID, Status: lp.StatusFragmentTimeout,
		})
	}
	batch := &pendingBatch{
		total:     m.TotalSize,
		count:     m.FragmentCount,
		fragments: map[uint64][]byte{},
	}
	batch.timer = time.AfterFunc(s.ReassemblyTimeout, func() {
		c.mu.Lock()
		if c.frags[fk] == batch {
			delete(c.frags, fk)
			c.mu.Unlock()
			s.sendMsg(context.Background(), c, &lp.Ack{
				Envelope: env, RefID: m.BatchID, Status: lp.StatusFragmentTimeout,
			})
			return
		}
		c.mu.Unlock()
	})
	c.frags[fk] = batch
	c.mu.Unlock()
}

func (s *Server) handleFragment(ctx context.Context, c *conn, env lp.Envelope, key roomKey, m *lp.DocUpdateFragment) {
	fk := fragKey{room: key, batch: m.BatchID}
	c.mu.Lock()
	batch := c.frags[fk]
	if batch == nil {
		c.mu.Unlock()
		return
	}
	if _, dup := batch.fragments[m.Index]; !dup && m.Index < batch.count {
		// The reader aliases its buffer; fragments outlive the frame.
		batch.fragments[m.Index] = append([]byte(nil), m.Fragment...)
		batch.received += uint64(len(m.Fragment))
	}
	complete := uint64(len(batch.fragments)) == batch.count
	if complete {
		batch.timer.Stop()
		delete(c.frags, fk)
	}
	c.mu.Unlock()
	if !complete {
		return
	}
	if batch.received != batch.total {
		s.sendMsg(ctx, c, &lp.Ack{Envelope: env, RefID: m.BatchID, Status: lp.StatusInvalidUpdate})
		return
	}
	payload := make([]byte, 0, batch.total)
	for i := uint64(0); i < batch.count; i++ {
		payload = append(payload, batch.fragments[i]...)
	}
	// A reassembled batch is exactly one update payload, acked by the
	// header's batch id — the official client's semantics.
	s.handleUpdate(ctx, c, env, key, m.BatchID, [][]byte{payload})
}

func (s *Server) unsubscribe(c *conn, key roomKey) {
	s.mu.Lock()
	delete(s.rooms[key], c)
	s.mu.Unlock()
	c.mu.Lock()
	delete(c.joined, key)
	c.mu.Unlock()
}

func (s *Server) drop(c *conn) {
	c.mu.Lock()
	keys := make([]roomKey, 0, len(c.joined))
	for key := range c.joined {
		keys = append(keys, key)
	}
	for _, batch := range c.frags {
		batch.timer.Stop()
	}
	c.frags = map[fragKey]*pendingBatch{}
	c.mu.Unlock()
	s.mu.Lock()
	for _, key := range keys {
		delete(s.rooms[key], c)
	}
	s.mu.Unlock()
	_ = c.ws.CloseNow()
}

// sendUpdates delivers payloads as DocUpdate messages, packing small ones
// together and splitting any single payload over the fragment limit —
// exactly what the official client does on its send path.
func (s *Server) sendUpdates(ctx context.Context, c *conn, env lp.Envelope, payloads [][]byte) {
	var packed [][]byte
	var packedSize int
	flush := func() {
		if len(packed) == 0 {
			return
		}
		s.sendMsg(ctx, c, &lp.DocUpdate{Envelope: env, Updates: packed, BatchID: randomBatchID()})
		packed, packedSize = nil, 0
	}
	for _, payload := range payloads {
		if len(payload) > fragLimit {
			flush()
			s.sendFragmented(ctx, c, env, payload)
			continue
		}
		if packedSize+len(payload) > fragLimit {
			flush()
		}
		packed = append(packed, payload)
		packedSize += len(payload)
	}
	flush()
}

func (s *Server) sendFragmented(ctx context.Context, c *conn, env lp.Envelope, payload []byte) {
	batchID := randomBatchID()
	count := (uint64(len(payload)) + fragLimit - 1) / fragLimit
	s.sendMsg(ctx, c, &lp.DocUpdateFragmentHeader{
		Envelope: env, BatchID: batchID, FragmentCount: count, TotalSize: uint64(len(payload)),
	})
	for i := uint64(0); i < count; i++ {
		start := i * fragLimit
		end := min(start+fragLimit, uint64(len(payload)))
		s.sendMsg(ctx, c, &lp.DocUpdateFragment{
			Envelope: env, BatchID: batchID, Index: i, Fragment: payload[start:end],
		})
	}
}

func (s *Server) sendMsg(ctx context.Context, c *conn, msg lp.Message) {
	data, err := lp.Encode(msg)
	if err != nil {
		s.logger.Error("encode failed", slog.Any("error", err))
		return
	}
	c.send(ctx, websocket.MessageBinary, data)
}

func (c *conn) send(ctx context.Context, typ websocket.MessageType, data []byte) {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	err := c.ws.Write(ctx, typ, data)
	if err != nil && !errors.Is(err, context.Canceled) {
		// The read loop notices the dead peer; nothing to do here.
		_ = err
	}
}

func randomBatchID() lp.BatchID {
	var id lp.BatchID
	_, _ = rand.Read(id[:])
	return id
}
