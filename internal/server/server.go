// Input: echo, internal/webauth
// Output: Server, Handler
// Pos: Server HTTP shell
//
// 🔄 Self-reference: When this file changes, update this header

// Package server is attentiond's echo shell, ported from Memoh's
// internal/server: middleware stack, JWT with a path skipper, and handlers
// as a Register(e) interface — one file per domain hangs itself on the
// router.
package server

import (
	"context"
	"log/slog"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"

	"github.com/cunninghamcard-bit/Attention/internal/webauth"
)

type Server struct {
	echo   *echo.Echo
	addr   string
	logger *slog.Logger
}

type Handler interface {
	Register(e *echo.Echo)
}

func New(log *slog.Logger, addr, jwtSecret string, handlers ...Handler) *Server {
	e := echo.New()
	e.HideBanner = true
	e.HidePort = true
	e.Use(middleware.Recover())
	// Everything is small except blob uploads, which carry their own
	// per-route 64M limit in the blobs handler.
	e.Use(middleware.BodyLimitWithConfig(middleware.BodyLimitConfig{
		Limit: "1M",
		Skipper: func(c echo.Context) bool {
			return strings.Contains(c.Request().URL.Path, "/blobs/")
		},
	}))
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: []string{"*"},
		AllowMethods: []string{echo.GET, echo.HEAD, echo.POST, echo.PUT, echo.PATCH, echo.DELETE, echo.OPTIONS},
		AllowHeaders: []string{echo.HeaderOrigin, echo.HeaderContentType, echo.HeaderAccept, echo.HeaderAuthorization},
	}))
	e.Use(middleware.RequestLoggerWithConfig(middleware.RequestLoggerConfig{
		LogStatus: true, LogURI: true, LogMethod: true,
		LogValuesFunc: func(c echo.Context, v middleware.RequestLoggerValues) error {
			log.Info("request",
				slog.String("method", v.Method), slog.String("uri", v.URI),
				slog.Int("status", v.Status), slog.Duration("latency", v.Latency))
			return nil
		},
	}))
	e.Use(webauth.JWTMiddleware(jwtSecret, shouldSkipJWT))

	for _, h := range handlers {
		if h != nil {
			h.Register(e)
		}
	}
	return &Server{echo: e, addr: addr, logger: log.With(slog.String("component", "server"))}
}

// shouldSkipJWT lists the anonymous surface: the static app, health,
// login/register, and /sync — whose auth is the loro-protocol join payload,
// because browsers cannot put an Authorization header on a WebSocket.
func shouldSkipJWT(c echo.Context) bool {
	path := c.Request().URL.Path
	if path == "/" || path == "/health" || path == "/sync" ||
		path == "/auth/login" || path == "/auth/register" {
		return true
	}
	return strings.HasPrefix(path, "/assets/")
}

func (s *Server) Start() error {
	s.logger.Info("attentiond listening", slog.String("addr", s.addr))
	return s.echo.Start(s.addr)
}

func (s *Server) Stop(ctx context.Context) error {
	return s.echo.Shutdown(ctx)
}
