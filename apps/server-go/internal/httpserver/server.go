package httpserver

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/DannyMang/chesstalk/apps/server-go/internal/auth"
	"github.com/DannyMang/chesstalk/apps/server-go/internal/config"
	"github.com/DannyMang/chesstalk/apps/server-go/internal/store"
	socket "github.com/DannyMang/chesstalk/apps/server-go/internal/ws"
)

func New(cfg config.Config, logger *slog.Logger, mongoStore *store.MongoStore, verifier *auth.Verifier) http.Handler {
	mux := http.NewServeMux()
	hub := socket.NewHub(cfg, logger, mongoStore, verifier)

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("content-type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})

	mux.HandleFunc("GET /game", hub.HandleGame)
	mux.HandleFunc("GET /audio", hub.HandleAudio)

	return requestLogger(logger, mux)
}

func requestLogger(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		logger.Info(
			"http request",
			"method", r.Method,
			"path", r.URL.Path,
			"durationMs", time.Since(start).Milliseconds(),
		)
	})
}
