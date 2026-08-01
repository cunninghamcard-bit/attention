// Input: embed
// Output: MigrationsFS
// Pos: Server data layer
//
// 🔄 Self-reference: When this file changes, update this header

package db

import "embed"

// MigrationsFS holds every SQL migration, embedded at compile time so the
// attentiond binary is its own migration tool (the Memoh model).
//
//go:embed postgres/migrations/*.sql
var MigrationsFS embed.FS
