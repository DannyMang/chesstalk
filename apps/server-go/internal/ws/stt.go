package ws

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/DannyMang/chesstalk/apps/server-go/internal/config"
	"github.com/gorilla/websocket"
)

const (
	deepgramListenURL      = "wss://api.deepgram.com/v1/listen"
	deepgramKeepAliveEvery = 3 * time.Second
	deepgramWriteWait      = 5 * time.Second
)

type STTService struct {
	apiKey string
	logger *slog.Logger
}

func NewSTTService(cfg config.Config, logger *slog.Logger) *STTService {
	return &STTService{
		apiKey: strings.TrimSpace(cfg.DeepgramAPIKey),
		logger: logger.With("component", "stt"),
	}
}

func (s *STTService) Enabled() bool {
	return s != nil && s.apiKey != ""
}

type STTTranscript struct {
	Text  string
	Final bool
}

type STTStreamOptions struct {
	GameID       string
	UserID       string
	Keyterms     []string
	OnTranscript func(STTTranscript)
	OnError      func(string)
}

type STTStream struct {
	gameID  string
	userID  string
	conn    *websocket.Conn
	logger  *slog.Logger
	onError func(string)

	mu     sync.Mutex
	closed bool
	done   chan struct{}
}

func (s *STTService) StartStream(opts STTStreamOptions) (*STTStream, error) {
	if !s.Enabled() {
		return nil, errors.New("Deepgram STT is not configured")
	}
	if opts.GameID == "" {
		return nil, errors.New("missing game ID")
	}
	u, err := url.Parse(deepgramListenURL)
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("model", "nova-3")
	q.Set("language", "en-US")
	q.Set("interim_results", "true")
	q.Set("endpointing", "250")
	q.Set("utterance_end_ms", "700")
	q.Set("vad_events", "true")
	q.Set("numerals", "true")
	q.Set("mip_opt_out", "true")
	for _, keyterm := range boundedKeyterms(opts.Keyterms) {
		q.Add("keyterm", keyterm)
	}
	u.RawQuery = q.Encode()

	header := http.Header{}
	header.Set("Authorization", "Token "+s.apiKey)
	conn, _, err := websocket.DefaultDialer.Dial(u.String(), header)
	if err != nil {
		return nil, err
	}
	stream := &STTStream{
		gameID:  opts.GameID,
		userID:  opts.UserID,
		conn:    conn,
		logger:  s.logger.With("gameId", opts.GameID, "userId", opts.UserID),
		onError: opts.OnError,
		done:    make(chan struct{}),
	}
	go stream.readLoop(opts.OnTranscript)
	go stream.keepAliveLoop()
	stream.logger.Info("deepgram stream started", "keyterms", len(opts.Keyterms))
	return stream, nil
}

func boundedKeyterms(keyterms []string) []string {
	seen := make(map[string]struct{}, len(keyterms))
	out := make([]string, 0, min(len(keyterms), 100))
	for _, keyterm := range keyterms {
		keyterm = strings.TrimSpace(keyterm)
		if keyterm == "" {
			continue
		}
		if _, ok := seen[keyterm]; ok {
			continue
		}
		seen[keyterm] = struct{}{}
		out = append(out, keyterm)
		if len(out) == 100 {
			return out
		}
	}
	return out
}

func (s *STTStream) AcceptAudioFrame(frame []byte) {
	if len(frame) == 0 {
		return
	}
	if err := s.write(websocket.BinaryMessage, frame); err != nil {
		s.logger.Warn("deepgram audio frame write failed", "err", err)
		s.reportError("Speech-to-text stream write failed")
		s.Close()
	}
}

func (s *STTStream) Close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	close(s.done)
	_ = s.conn.SetWriteDeadline(time.Now().Add(deepgramWriteWait))
	_ = s.conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"CloseStream"}`))
	_ = s.conn.Close()
	s.mu.Unlock()
}

func (s *STTStream) write(messageType int, payload []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	_ = s.conn.SetWriteDeadline(time.Now().Add(deepgramWriteWait))
	return s.conn.WriteMessage(messageType, payload)
}

func (s *STTStream) keepAliveLoop() {
	ticker := time.NewTicker(deepgramKeepAliveEvery)
	defer ticker.Stop()
	for {
		select {
		case <-s.done:
			return
		case <-ticker.C:
			if err := s.write(websocket.TextMessage, []byte(`{"type":"KeepAlive"}`)); err != nil {
				s.logger.Warn("deepgram keepalive failed", "err", err)
				s.reportError("Speech-to-text stream disconnected")
				s.Close()
				return
			}
		}
	}
}

func (s *STTStream) readLoop(onTranscript func(STTTranscript)) {
	defer s.Close()
	for {
		_, payload, err := s.conn.ReadMessage()
		if err != nil {
			s.logger.Info("deepgram read stopped", "err", err)
			return
		}
		msg, ok := parseDeepgramMessage(payload)
		if !ok {
			continue
		}
		switch msg.Type {
		case "Results":
			text := strings.TrimSpace(msg.Channel.firstTranscript())
			if text == "" || onTranscript == nil {
				continue
			}
			onTranscript(STTTranscript{
				Text:  text,
				Final: msg.SpeechFinal || (msg.IsFinal && msg.FromFinalize),
			})
		case "Error":
			message := strings.TrimSpace(msg.Message)
			if message == "" {
				message = "Speech-to-text provider error"
			}
			s.logger.Warn("deepgram error", "message", message)
			s.reportError(message)
		}
	}
}

func (s *STTStream) reportError(message string) {
	if s.onError != nil {
		s.onError(message)
	}
}

type deepgramMessage struct {
	Type         string          `json:"type"`
	Message      string          `json:"message"`
	IsFinal      bool            `json:"is_final"`
	SpeechFinal  bool            `json:"speech_final"`
	FromFinalize bool            `json:"from_finalize"`
	Channel      deepgramChannel `json:"channel"`
}

type deepgramChannel struct {
	Alternatives []deepgramAlternative `json:"alternatives"`
}

type deepgramAlternative struct {
	Transcript string `json:"transcript"`
}

func (c deepgramChannel) firstTranscript() string {
	if len(c.Alternatives) == 0 {
		return ""
	}
	return c.Alternatives[0].Transcript
}

func parseDeepgramMessage(payload []byte) (deepgramMessage, bool) {
	var msg deepgramMessage
	if err := json.Unmarshal(payload, &msg); err != nil {
		return deepgramMessage{}, false
	}
	return msg, true
}
