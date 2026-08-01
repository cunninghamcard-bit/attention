// Input: echo, internal/accounts
// Output: AuthHandler
// Pos: Server HTTP handlers
//
// 🔄 Self-reference: When this file changes, update this header

// Package handlers holds attentiond's route handlers, one file per domain,
// each hanging itself on the router via Register (the Memoh shape).
package handlers

import (
	"errors"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/cunninghamcard-bit/Attention/internal/accounts"
)

type AuthHandler struct {
	Accounts *accounts.Service
}

type CredentialsRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type SessionResponse struct {
	AccessToken string    `json:"access_token"`
	TokenType   string    `json:"token_type"`
	ExpiresAt   time.Time `json:"expires_at"`
	UserID      string    `json:"user_id"`
	Email       string    `json:"email"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

func (h *AuthHandler) Register(e *echo.Echo) {
	e.POST("/auth/register", h.register)
	e.POST("/auth/login", h.login)
}

func (h *AuthHandler) register(c echo.Context) error {
	var req CredentialsRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, ErrorResponse{Error: "invalid request body"})
	}
	session, err := h.Accounts.Register(c.Request().Context(), req.Email, req.Password)
	if err != nil {
		return c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
	}
	return c.JSON(http.StatusOK, toSession(session))
}

func (h *AuthHandler) login(c echo.Context) error {
	var req CredentialsRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, ErrorResponse{Error: "invalid request body"})
	}
	session, err := h.Accounts.Login(c.Request().Context(), req.Email, req.Password)
	if errors.Is(err, accounts.ErrBadCredentials) {
		return c.JSON(http.StatusUnauthorized, ErrorResponse{Error: err.Error()})
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "login failed"})
	}
	return c.JSON(http.StatusOK, toSession(session))
}

func toSession(s accounts.Session) SessionResponse {
	return SessionResponse{
		AccessToken: s.Token, TokenType: "Bearer", ExpiresAt: s.ExpiresAt,
		UserID: s.UserID, Email: s.Email,
	}
}
