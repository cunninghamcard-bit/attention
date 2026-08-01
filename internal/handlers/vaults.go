// Input: echo, internal/accounts, internal/store, internal/webauth
// Output: VaultsHandler
// Pos: Server HTTP handlers
//
// 🔄 Self-reference: When this file changes, update this header

package handlers

import (
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"

	"github.com/cunninghamcard-bit/Attention/internal/accounts"
	"github.com/cunninghamcard-bit/Attention/internal/store"
	"github.com/cunninghamcard-bit/Attention/internal/webauth"
)

type VaultsHandler struct {
	Accounts *accounts.Service
	Store    *store.Store
}

type CreateVaultRequest struct {
	Name string `json:"name"`
}

type VaultResponse struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
}

func (h *VaultsHandler) Register(e *echo.Echo) {
	e.POST("/api/vaults", h.create)
	e.GET("/api/vaults", h.list)
	// Attachments: content-addressed per vault, dedup by hash, own 64M cap.
	blobLimit := middleware.BodyLimit("64M")
	e.PUT("/api/vaults/:vault/blobs/:hash", h.putBlob, blobLimit)
	e.GET("/api/vaults/:vault/blobs/:hash", h.getBlob)
}

func (h *VaultsHandler) create(c echo.Context) error {
	userID, err := webauth.UserIDFromContext(c)
	if err != nil {
		return err
	}
	var req CreateVaultRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, ErrorResponse{Error: "invalid request body"})
	}
	vault, err := h.Accounts.CreateVault(c.Request().Context(), userID, req.Name)
	if err != nil {
		return c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
	}
	return c.JSON(http.StatusOK, VaultResponse{
		ID: vault.ID, Name: vault.Name, Role: "owner", CreatedAt: vault.CreatedAt.Time,
	})
}

func (h *VaultsHandler) list(c echo.Context) error {
	userID, err := webauth.UserIDFromContext(c)
	if err != nil {
		return err
	}
	rows, err := h.Accounts.ListVaults(c.Request().Context(), userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "list failed"})
	}
	out := make([]VaultResponse, 0, len(rows))
	for _, row := range rows {
		out = append(out, VaultResponse{
			ID: row.ID, Name: row.Name, Role: string(row.Role), CreatedAt: row.CreatedAt.Time,
		})
	}
	return c.JSON(http.StatusOK, out)
}

// requireMember gates blob access on vault membership.
func (h *VaultsHandler) requireMember(c echo.Context) (vaultID string, err error) {
	userID, err := webauth.UserIDFromContext(c)
	if err != nil {
		return "", err
	}
	vaultID = c.Param("vault")
	if _, err := h.Accounts.Membership(c.Request().Context(), vaultID, userID); err != nil {
		return "", echo.NewHTTPError(http.StatusForbidden, "not a member of this vault")
	}
	return vaultID, nil
}

func (h *VaultsHandler) putBlob(c echo.Context) error {
	vaultID, err := h.requireMember(c)
	if err != nil {
		return err
	}
	payload, err := io.ReadAll(c.Request().Body)
	if err != nil {
		return c.JSON(http.StatusBadRequest, ErrorResponse{Error: "read body failed"})
	}
	if err := h.Store.PutBlob(c.Request().Context(), vaultID, c.Param("hash"), payload); err != nil {
		return c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "store failed"})
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *VaultsHandler) getBlob(c echo.Context) error {
	vaultID, err := h.requireMember(c)
	if err != nil {
		return err
	}
	payload, err := h.Store.GetBlob(c.Request().Context(), vaultID, c.Param("hash"))
	if errors.Is(err, pgx.ErrNoRows) {
		return echo.NewHTTPError(http.StatusNotFound, "no such blob")
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "read failed"})
	}
	return c.Blob(http.StatusOK, "application/octet-stream", payload)
}
