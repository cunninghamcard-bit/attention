// Input: echo, internal/syncd
// Output: SyncHandler, StaticHandler, HealthHandler
// Pos: Server HTTP handlers
//
// 🔄 Self-reference: When this file changes, update this header

package handlers

import (
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/cunninghamcard-bit/Attention/internal/syncd"
)

// SyncHandler mounts the loro-protocol engine. The route skips the JWT
// middleware; auth happens per room join inside syncd.
type SyncHandler struct {
	Engine *syncd.Server
}

func (h *SyncHandler) Register(e *echo.Echo) {
	e.GET("/sync", func(c echo.Context) error {
		h.Engine.ServeHTTP(c.Response(), c.Request())
		return nil
	})
}

// StaticHandler serves the built web app — the Web head. Empty dir means
// this deployment serves no UI (API and sync only).
type StaticHandler struct {
	Dir string
}

func (h *StaticHandler) Register(e *echo.Echo) {
	if h.Dir == "" {
		return
	}
	e.Static("/", h.Dir)
}

type HealthHandler struct {
	Ping func() error
}

func (h *HealthHandler) Register(e *echo.Echo) {
	e.GET("/health", func(c echo.Context) error {
		if err := h.Ping(); err != nil {
			return echo.NewHTTPError(http.StatusServiceUnavailable, "db unreachable")
		}
		return c.String(http.StatusOK, "ok")
	})
}
