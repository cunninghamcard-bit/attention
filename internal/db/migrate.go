// Input: db (embedded migrations), golang-migrate
// Output: Migrate
// Pos: Server data layer
//
// 🔄 Self-reference: When this file changes, update this header

package db

import (
	"errors"
	"fmt"
	"strconv"

	"github.com/golang-migrate/migrate/v4"
	// Registers the postgres database driver for golang-migrate.
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"

	dbfs "github.com/cunninghamcard-bit/Attention/db"
)

// Migrate runs a migration command against dsn using the embedded SQL files:
// "up", "down", "version", or "force N" — the same verbs Memoh's server
// exposes. Returns a human-readable status line.
func Migrate(dsn string, args []string) (string, error) {
	if len(args) == 0 {
		return "", errors.New("usage: migrate <up|down|version|force N>")
	}
	source, err := iofs.New(dbfs.MigrationsFS, "postgres/migrations")
	if err != nil {
		return "", fmt.Errorf("load embedded migrations: %w", err)
	}
	m, err := migrate.NewWithSourceInstance("iofs", source, dsn)
	if err != nil {
		return "", fmt.Errorf("open migrator: %w", err)
	}
	defer m.Close()

	switch args[0] {
	case "up":
		if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
			return "", err
		}
		return describeVersion(m)
	case "down":
		if err := m.Steps(-1); err != nil {
			return "", err
		}
		return describeVersion(m)
	case "version":
		return describeVersion(m)
	case "force":
		if len(args) < 2 {
			return "", errors.New("usage: migrate force N")
		}
		n, err := strconv.Atoi(args[1])
		if err != nil {
			return "", fmt.Errorf("force: %w", err)
		}
		if err := m.Force(n); err != nil {
			return "", err
		}
		return describeVersion(m)
	default:
		return "", fmt.Errorf("unknown migrate command %q", args[0])
	}
}

func describeVersion(m *migrate.Migrate) (string, error) {
	version, dirty, err := m.Version()
	if errors.Is(err, migrate.ErrNilVersion) {
		return "version: none", nil
	}
	if err != nil {
		return "", err
	}
	if dirty {
		return fmt.Sprintf("version: %d (dirty)", version), nil
	}
	return fmt.Sprintf("version: %d", version), nil
}
