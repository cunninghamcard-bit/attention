// Input: pgxpool, internal/db/postgres/sqlc
// Output: Store, Update, RoomState
// Pos: Server data layer
//
// 🔄 Self-reference: When this file changes, update this header

package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cunninghamcard-bit/Attention/internal/db/postgres/sqlc"
)

// Store is the data plane behind syncd: opaque room logs, snapshots and
// blobs. It never inspects payload bytes — the server-side half of the
// "only clients understand loro" invariant. Room identity is
// (vault, roomID, crdtType) because the protocol treats the same room id
// under a different CRDT type as a different room.
type Store struct {
	pool    *pgxpool.Pool
	queries *sqlc.Queries
}

func New(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool, queries: sqlc.New(pool)}
}

// Update is one stored room-log entry. N is storage order within the room,
// never wire-visible.
type Update struct {
	N     int64
	Bytes []byte
}

// RoomState is everything a joining client needs: the compacted snapshot
// (if any) plus the log after it. Idempotent client import makes sending
// the whole thing harmless.
type RoomState struct {
	Snapshot []byte
	Log      []Update
}

// AppendUpdate stores one opaque payload and returns its storage order.
// The room row is created on first use and serves as the per-room append
// lock, so n assignment is serialized per room and never collides.
// ponytail: a per-room row lock caps write throughput per room; move n to a
// per-room sequence if a hot room ever shows up in profiles.
func (s *Store) AppendUpdate(ctx context.Context, vaultID, roomID string, crdtType int16, payload []byte) (int64, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.queries.WithTx(tx)

	key := sqlc.UpsertRoomParams{VaultID: vaultID, RoomID: roomID, CrdtType: crdtType}
	if err := q.UpsertRoom(ctx, key); err != nil {
		return 0, err
	}
	if _, err := q.LockRoom(ctx, sqlc.LockRoomParams(key)); err != nil {
		return 0, err
	}
	n, err := q.AppendRoomLog(ctx, sqlc.AppendRoomLogParams{
		VaultID: vaultID, RoomID: roomID, CrdtType: crdtType, Bytes: payload,
	})
	if err != nil {
		return 0, err
	}
	return n, tx.Commit(ctx)
}

// RoomStateSince reads the room for a joining client: its snapshot plus log
// entries after n. Use n=0 for a full read. A room that has never existed
// is an empty state, not an error — joining it is what creates it.
func (s *Store) RoomStateSince(ctx context.Context, vaultID, roomID string, crdtType int16, after int64) (RoomState, error) {
	room, err := s.queries.GetRoom(ctx, sqlc.GetRoomParams{
		VaultID: vaultID, RoomID: roomID, CrdtType: crdtType,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return RoomState{}, nil
	}
	if err != nil {
		return RoomState{}, err
	}
	rows, err := s.queries.ScanRoomLog(ctx, sqlc.ScanRoomLogParams{
		VaultID: vaultID, RoomID: roomID, CrdtType: crdtType, N: after,
	})
	if err != nil {
		return RoomState{}, err
	}
	state := RoomState{Snapshot: room.Snapshot, Log: make([]Update, 0, len(rows))}
	for _, row := range rows {
		state.Log = append(state.Log, Update{N: row.N, Bytes: row.Bytes})
	}
	return state, nil
}

// CompactRoom stores a client-uploaded snapshot and drops the log through
// its watermark. The snapshot subsumes those entries; idempotent import
// keeps any client that already consumed them safe.
func (s *Store) CompactRoom(ctx context.Context, vaultID, roomID string, crdtType int16, snapshot []byte, throughN int64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.queries.WithTx(tx)

	key := sqlc.LockRoomParams{VaultID: vaultID, RoomID: roomID, CrdtType: crdtType}
	if _, err := q.LockRoom(ctx, key); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("compact: room does not exist")
		}
		return err
	}
	if err := q.SetRoomSnapshot(ctx, sqlc.SetRoomSnapshotParams{
		VaultID: vaultID, RoomID: roomID, CrdtType: crdtType, Snapshot: snapshot,
	}); err != nil {
		return err
	}
	if _, err := q.DeleteRoomLogThrough(ctx, sqlc.DeleteRoomLogThroughParams{
		VaultID: vaultID, RoomID: roomID, CrdtType: crdtType, N: throughN,
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// PutBlob stores an attachment; same hash twice is a no-op (dedup).
func (s *Store) PutBlob(ctx context.Context, vaultID, hash string, payload []byte) error {
	return s.queries.PutBlob(ctx, sqlc.PutBlobParams{
		VaultID: vaultID, Hash: hash, Bytes: payload, Size: int64(len(payload)),
	})
}

// GetBlob returns the attachment bytes, or pgx.ErrNoRows when absent.
func (s *Store) GetBlob(ctx context.Context, vaultID, hash string) ([]byte, error) {
	return s.queries.GetBlob(ctx, sqlc.GetBlobParams{VaultID: vaultID, Hash: hash})
}
