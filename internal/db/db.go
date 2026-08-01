// Input: pgxpool
// Output: Connect
// Pos: Server data layer
//
// 🔄 Self-reference: When this file changes, update this header

package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Connect opens a pgx pool and verifies the database is reachable before
// handing it back — a dead DSN should fail at boot, not on first query.
func Connect(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}
