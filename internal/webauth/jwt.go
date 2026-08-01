// Input: golang-jwt, echo-jwt
// Output: JWTMiddleware, UserIDFromContext, GenerateToken, ParseUserID
// Pos: Server auth layer
//
// 🔄 Self-reference: When this file changes, update this header

// Package webauth is attentiond's stateless JWT layer, ported from Memoh's
// internal/auth (HS256, sub/user_id claims). Named webauth because
// internal/auth already belongs to the agent kernel's credential store.
package webauth

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	echojwt "github.com/labstack/echo-jwt/v4"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
)

const (
	claimSubject = "sub"
	claimUserID  = "user_id"
)

// JWTMiddleware returns a JWT auth middleware configured for HS256 tokens.
func JWTMiddleware(secret string, skipper middleware.Skipper) echo.MiddlewareFunc {
	return echojwt.WithConfig(echojwt.Config{
		SigningKey:    []byte(secret),
		SigningMethod: "HS256",
		TokenLookup:   "header:Authorization:Bearer ",
		Skipper:       skipper,
		NewClaimsFunc: func(_ echo.Context) jwt.Claims {
			return jwt.MapClaims{}
		},
	})
}

// UserIDFromContext extracts the user id the middleware verified.
func UserIDFromContext(c echo.Context) (string, error) {
	token, ok := c.Get("user").(*jwt.Token)
	if !ok || token == nil || !token.Valid {
		return "", echo.NewHTTPError(http.StatusUnauthorized, "invalid token")
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", echo.NewHTTPError(http.StatusUnauthorized, "invalid token claims")
	}
	if id, _ := claims[claimUserID].(string); id != "" {
		return id, nil
	}
	if id, _ := claims[claimSubject].(string); id != "" {
		return id, nil
	}
	return "", echo.NewHTTPError(http.StatusUnauthorized, "user id missing")
}

// GenerateToken creates a signed JWT for the user.
func GenerateToken(userID, secret string, expiresIn time.Duration) (string, time.Time, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(secret) == "" || expiresIn <= 0 {
		return "", time.Time{}, errors.New("user id, secret and positive expiry are required")
	}
	now := time.Now().UTC()
	expiresAt := now.Add(expiresIn)
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		claimSubject: userID,
		claimUserID:  userID,
		"iat":        now.Unix(),
		"exp":        expiresAt.Unix(),
	})
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		return "", time.Time{}, err
	}
	return signed, expiresAt, nil
}

// ParseUserID verifies a raw token string outside any HTTP context — the
// /sync path, where the token arrives in the loro-protocol join payload
// because browsers cannot put headers on a WebSocket.
func ParseUserID(tokenString, secret string) (string, error) {
	token, err := jwt.Parse(tokenString, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(secret), nil
	})
	if err != nil || !token.Valid {
		return "", errors.New("invalid token")
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", errors.New("invalid token claims")
	}
	if id, _ := claims[claimUserID].(string); id != "" {
		return id, nil
	}
	if id, _ := claims[claimSubject].(string); id != "" {
		return id, nil
	}
	return "", errors.New("user id missing")
}
