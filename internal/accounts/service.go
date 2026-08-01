// Input: internal/db/postgres/sqlc, internal/webauth, x/crypto/argon2, loro-protocol-go
// Output: Service, SyncAuthorizer
// Pos: Server accounts layer
//
// 🔄 Self-reference: When this file changes, update this header

// Package accounts is registration, login and vault membership — the
// control plane. Password hashing is argon2id in the standard encoded
// form; tokens are webauth's stateless JWTs.
package accounts

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	lp "github.com/cunninghamcard-bit/loro-protocol-go"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/argon2"

	"github.com/cunninghamcard-bit/Attention/internal/db/postgres/sqlc"
	"github.com/cunninghamcard-bit/Attention/internal/webauth"
)

var (
	ErrBadCredentials = errors.New("invalid email or password")
	ErrNotMember      = errors.New("not a member of this vault")
)

type Service struct {
	queries   *sqlc.Queries
	secret    string
	expiresIn time.Duration
}

func New(pool *pgxpool.Pool, jwtSecret string, expiresIn time.Duration) *Service {
	return &Service{queries: sqlc.New(pool), secret: jwtSecret, expiresIn: expiresIn}
}

type Session struct {
	Token     string
	ExpiresAt time.Time
	UserID    string
	Email     string
}

func (s *Service) Register(ctx context.Context, email, password string) (Session, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || !strings.Contains(email, "@") {
		return Session{}, errors.New("a valid email is required")
	}
	if len(password) < 8 {
		return Session{}, errors.New("password must be at least 8 characters")
	}
	hash, err := hashPassword(password)
	if err != nil {
		return Session{}, err
	}
	user, err := s.queries.CreateUser(ctx, sqlc.CreateUserParams{Email: email, PassHash: hash})
	if err != nil {
		return Session{}, fmt.Errorf("create user: %w", err)
	}
	return s.session(user.ID, email)
}

func (s *Service) Login(ctx context.Context, email, password string) (Session, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	user, err := s.queries.GetUserByEmail(ctx, email)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrBadCredentials
	}
	if err != nil {
		return Session{}, err
	}
	if !verifyPassword(password, user.PassHash) {
		return Session{}, ErrBadCredentials
	}
	return s.session(user.ID, email)
}

func (s *Service) session(userID, email string) (Session, error) {
	token, expiresAt, err := webauth.GenerateToken(userID, s.secret, s.expiresIn)
	if err != nil {
		return Session{}, err
	}
	return Session{Token: token, ExpiresAt: expiresAt, UserID: userID, Email: email}, nil
}

// CreateVault makes the vault and seats its owner in one step.
func (s *Service) CreateVault(ctx context.Context, ownerID, name string) (sqlc.Vault, error) {
	if strings.TrimSpace(name) == "" {
		return sqlc.Vault{}, errors.New("vault name is required")
	}
	vault, err := s.queries.CreateVault(ctx, sqlc.CreateVaultParams{OwnerID: ownerID, Name: name})
	if err != nil {
		return sqlc.Vault{}, err
	}
	err = s.queries.AddVaultMember(ctx, sqlc.AddVaultMemberParams{
		VaultID: vault.ID, UserID: ownerID, Role: "owner",
	})
	return vault, err
}

func (s *Service) ListVaults(ctx context.Context, userID string) ([]sqlc.ListVaultsForUserRow, error) {
	return s.queries.ListVaultsForUser(ctx, userID)
}

// Membership answers a user's role in a vault, ErrNotMember when none.
func (s *Service) Membership(ctx context.Context, vaultID, userID string) (string, error) {
	role, err := s.queries.GetVaultMember(ctx, sqlc.GetVaultMemberParams{
		VaultID: vaultID, UserID: userID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotMember
	}
	return string(role), err
}

// SyncAuthorizer adapts accounts+JWT to syncd's Authorizer: the join
// payload is the raw JWT, the vault half of the room id is the resource.
type SyncAuthorizer struct {
	Accounts *Service
	Secret   string
}

func (a SyncAuthorizer) Authorize(ctx context.Context, auth []byte, vaultID string) (lp.Permission, error) {
	userID, err := webauth.ParseUserID(string(auth), a.Secret)
	if err != nil {
		return 0, err
	}
	role, err := a.Accounts.Membership(ctx, vaultID, userID)
	if err != nil {
		return 0, err
	}
	switch role {
	case "owner", "editor":
		return lp.PermissionWrite, nil
	default:
		return lp.PermissionRead, nil
	}
}

// --- argon2id in the standard $argon2id$v=19$m=…,t=…,p=…$salt$hash form ---

const (
	argonMemory  = 64 * 1024
	argonTime    = 1
	argonThreads = 4
	argonKeyLen  = 32
)

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key)), nil
}

func verifyPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return false
	}
	var memory, timeCost uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &timeCost, &threads); err != nil {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, timeCost, memory, threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}
