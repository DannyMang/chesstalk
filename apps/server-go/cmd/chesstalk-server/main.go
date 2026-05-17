package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/DannyMang/chesstalk/apps/server-go/internal/auth"
	"github.com/DannyMang/chesstalk/apps/server-go/internal/config"
	"github.com/DannyMang/chesstalk/apps/server-go/internal/httpserver"
	"github.com/DannyMang/chesstalk/apps/server-go/internal/store"
	socket "github.com/DannyMang/chesstalk/apps/server-go/internal/ws"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg := config.Load()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	mongoStore, err := store.Connect(ctx, cfg.MongoURI)
	cancel()
	if err != nil {
		logger.Error("mongo connection failed", "err", err)
		os.Exit(1)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := mongoStore.Disconnect(ctx); err != nil {
			logger.Error("mongo disconnect failed", "err", err)
		}
	}()
	ctx, cancel = context.WithTimeout(context.Background(), 10*time.Second)
	if err := mongoStore.EnsureIndexes(ctx); err != nil {
		cancel()
		logger.Error("mongo index setup failed", "err", err)
		os.Exit(1)
	}
	cancel()

	ctx, cancel = context.WithTimeout(context.Background(), 10*time.Second)
	verifier, err := auth.NewVerifier(ctx, auth.Options{
		JWKSURL:  cfg.ClerkJWKSURL,
		Issuer:   cfg.ClerkIssuer,
		Audience: cfg.ClerkAudience,
		AZP:      cfg.ClerkAZP,
	})
	cancel()
	if err != nil {
		logger.Error("clerk verifier setup failed", "err", err)
		os.Exit(1)
	}

	hub := socket.NewHub(cfg, logger, mongoStore, verifier)

	ctx, cancel = context.WithTimeout(context.Background(), 15*time.Second)
	if err := hub.RehydrateActiveGames(ctx); err != nil {
		logger.Error("rehydrate active games failed", "err", err)
	}
	cancel()

	hub.StartCheckpointer(2 * time.Second)
	defer hub.StopCheckpointer()
	hub.StartMetricsEmitter(10 * time.Second)
	defer hub.StopMetricsEmitter()

	server := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           httpserver.New(logger, hub),
		ReadHeaderTimeout: 5 * time.Second,
	}

	errs := make(chan error, 1)
	go func() {
		logger.Info("chesstalk go server listening", "addr", server.Addr)
		errs <- server.ListenAndServe()
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-errs:
		if err != nil && err != http.ErrServerClosed {
			logger.Error("server failed", "err", err)
			os.Exit(1)
		}
	case sig := <-stop:
		logger.Info("shutdown signal received", "signal", sig.String())
	}

	ctx, cancel = context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		logger.Error("graceful shutdown failed", "err", err)
		os.Exit(1)
	}
}
