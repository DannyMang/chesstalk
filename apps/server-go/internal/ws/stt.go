package ws

import (
	"log/slog"

	"github.com/DannyMang/chesstalk/apps/server-go/internal/config"
)

type STTService struct {
	enabled bool
	logger  *slog.Logger
}

func NewSTTService(cfg config.Config, logger *slog.Logger) *STTService {
	return &STTService{
		enabled: cfg.DeepgramAPIKey != "",
		logger:  logger.With("component", "stt"),
	}
}

func (s *STTService) Enabled() bool {
	return s != nil && s.enabled
}

func (s *STTService) AcceptAudioFrame(gameID string, userID string, frame []byte) {
	if !s.Enabled() {
		return
	}
	// TODO: Bridge browser audio frames to Deepgram's streaming API, then feed
	// interim/final transcripts through the same path as audio:transcript.
	// Kept as an isolated service so the WebSocket and game logic do not need
	// to change when production STT lands.
	s.logger.Debug("audio frame accepted for future Deepgram stream", "gameId", gameID, "userId", userID, "bytes", len(frame))
}
