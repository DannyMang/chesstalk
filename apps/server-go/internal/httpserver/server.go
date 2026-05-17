package httpserver

import (
	"log/slog"
	"net/http"
	"time"

	socket "github.com/DannyMang/chesstalk/apps/server-go/internal/ws"
)

func New(logger *slog.Logger, hub *socket.Hub) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("content-type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})

	mux.HandleFunc("GET /game", hub.HandleGame)
	mux.HandleFunc("GET /audio", hub.HandleAudio)
	mux.HandleFunc("GET /metrics/internal", hub.HandleMetrics)

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
