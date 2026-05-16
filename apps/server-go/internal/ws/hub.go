package ws

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/DannyMang/chesstalk/apps/server-go/internal/auth"
	"github.com/DannyMang/chesstalk/apps/server-go/internal/config"
	"github.com/DannyMang/chesstalk/apps/server-go/internal/game"
	"github.com/DannyMang/chesstalk/apps/server-go/internal/protocol"
	"github.com/DannyMang/chesstalk/apps/server-go/internal/ratelimit"
	"github.com/DannyMang/chesstalk/apps/server-go/internal/store"
	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = 30 * time.Second
	maxControlSize = protocol.MaxAudioJSONBytes
	reconnectGrace = 10 * time.Second
)

const botUserID = "bot:go-legal-move"

type Hub struct {
	config     config.Config
	logger     *slog.Logger
	store      *store.MongoStore
	auth       *auth.Verifier
	stt        *STTService
	bot        *BotEngine
	registry   *game.Registry
	matchmaker *game.Matchmaker
	invites    *game.InviteRegistry
}

func NewHub(cfg config.Config, logger *slog.Logger, mongoStore *store.MongoStore, verifier *auth.Verifier) *Hub {
	registry := game.NewRegistry()
	registry.StartTicker()
	return &Hub{
		config:     cfg,
		logger:     logger,
		store:      mongoStore,
		auth:       verifier,
		stt:        NewSTTService(cfg, logger),
		bot:        NewBotEngine(cfg, logger),
		registry:   registry,
		matchmaker: game.NewMatchmaker(),
		invites:    game.NewInviteRegistry(),
	}
}

func (h *Hub) HandleGame(w http.ResponseWriter, r *http.Request) {
	h.handle(w, r, "game")
}

func (h *Hub) HandleAudio(w http.ResponseWriter, r *http.Request) {
	h.handle(w, r, "audio")
}

func (h *Hub) handle(w http.ResponseWriter, r *http.Request, kind string) {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			_, ok := h.config.AllowedOrigins[origin]
			return ok
		},
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Warn("websocket upgrade failed", "kind", kind, "err", err)
		return
	}

	identity, ok := h.identityFromRequest(r)
	if !ok {
		_ = conn.WriteControl(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(4401, "unauthorized"),
			time.Now().Add(writeWait),
		)
		_ = conn.Close()
		return
	}

	client := &client{
		hub:         h,
		conn:        conn,
		kind:        kind,
		clerkUserID: identity,
		logger:      h.logger.With("socket", kind, "clerkUserId", identity),
		limiter:     newLimiter(kind),
		lastSeen:    time.Now(),
	}
	client.run()
}

func (h *Hub) identityFromRequest(r *http.Request) (string, bool) {
	if guestID := sanitizeGuestID(r.URL.Query().Get("guestId")); guestID != "" {
		return "guest:" + guestID, true
	}

	token := strings.TrimSpace(r.URL.Query().Get("token"))
	if token == "" {
		return "", false
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	subject, err := h.auth.Subject(ctx, token)
	if err != nil {
		return "", false
	}
	return subject, true
}

func sanitizeGuestID(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if len(trimmed) < 8 || len(trimmed) > 80 {
		return ""
	}
	for _, r := range trimmed {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			continue
		}
		return ""
	}
	return trimmed
}

func fallbackUsername(clerkUserID string) string {
	if strings.HasPrefix(clerkUserID, "guest:") {
		suffix := clerkUserID
		if len(suffix) > 6 {
			suffix = suffix[len(suffix)-6:]
		}
		return "guest_" + suffix
	}
	suffix := clerkUserID
	if len(suffix) > 6 {
		suffix = suffix[len(suffix)-6:]
	}
	return "player_" + suffix
}

func randomID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return intString(time.Now().UnixNano())
	}
	return fmtHex(b[:])
}

func fmtHex(bytes []byte) string {
	const alphabet = "0123456789abcdef"
	out := make([]byte, len(bytes)*2)
	for i, b := range bytes {
		out[i*2] = alphabet[b>>4]
		out[i*2+1] = alphabet[b&0x0f]
	}
	return string(out)
}

func intString[T ~int | ~int64](value T) string {
	return strconv.FormatInt(int64(value), 10)
}

type client struct {
	hub         *Hub
	conn        *websocket.Conn
	kind        string
	clerkUserID string
	userID      string
	username    string
	logger      *slog.Logger
	limiter     *ratelimit.Limiter
	lastSeen    time.Time
	writeMu     sync.Mutex
	sttMu       sync.Mutex
	sttStream   *STTStream
}

func (c *client) run() {
	defer func() {
		c.cleanup()
		_ = c.conn.Close()
		c.logger.Info("socket closed")
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	user, err := c.hub.store.EnsureUser(ctx, c.clerkUserID, fallbackUsername(c.clerkUserID))
	cancel()
	if err != nil {
		c.logger.Error("ensure user failed", "err", err)
		c.closePolicy("failed to load user")
		return
	}
	c.userID = user.ID
	c.username = user.Username
	c.logger = c.logger.With("userId", c.userID, "username", c.username)

	if c.kind == "audio" {
		c.conn.SetReadLimit(protocol.MaxAudioFrameBytes)
	} else {
		c.conn.SetReadLimit(maxControlSize)
	}
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.lastSeen = time.Now()
		return c.conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	done := make(chan struct{})
	go c.heartbeat(done)
	defer close(done)

	for {
		messageType, data, err := c.conn.ReadMessage()
		if err != nil {
			c.logger.Info("read failed", "err", err)
			return
		}

		switch c.kind {
		case "game":
			c.handleGame(messageType, data)
		case "audio":
			c.handleAudio(messageType, data)
		}
	}
}

func (c *client) heartbeat(done <-chan struct{}) {
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()

	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			c.writeMu.Lock()
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			err := c.conn.WriteMessage(websocket.PingMessage, nil)
			c.writeMu.Unlock()
			if err != nil {
				c.logger.Warn("ping failed", "err", err)
				_ = c.conn.Close()
				return
			}
		}
	}
}

func (c *client) handleGame(messageType int, data []byte) {
	if messageType != websocket.TextMessage {
		c.closePolicy("game socket accepts JSON text only")
		return
	}

	msg, err := protocol.ValidateGameMessage(data)
	if err != nil {
		c.rateLimitedError("invalid", "invalid_message", err.Error())
		return
	}
	if !c.limiter.Take(gameBucket(msg.Type)) {
		c.sendJSON(map[string]any{"type": "error", "code": "rate_limited", "message": "Too many messages; slow down"})
		return
	}

	switch msg.Type {
	case "ping":
		c.sendJSON(map[string]any{"type": "pong", "t": msg.T, "serverNow": time.Now().UnixMilli()})
	case "queue:join":
		c.handleQueueJoin(msg)
	case "queue:leave":
		c.hub.matchmaker.Leave(c.userID)
	case "invite:create":
		c.handleInviteCreate(msg)
	case "invite:join":
		c.handleInviteJoin(msg)
	case "game:resume":
		c.handleGameResume(msg)
	case "move:propose":
		c.handleMovePropose(msg)
	case "game:resign":
		c.handleResign(msg)
	case "game:offerDraw":
		c.handleOfferDraw(msg)
	case "game:acceptDraw":
		c.handleAcceptDraw(msg)
	case "bot:start":
		c.handleBotStart(msg)
	}
}

func (c *client) handleAudio(messageType int, data []byte) {
	if messageType == websocket.BinaryMessage {
		if len(data) > protocol.MaxAudioFrameBytes {
			c.closeTooLarge("audio frame too large")
			return
		}
		if !c.limiter.Take("audio_frame") {
			return
		}
		stream := c.currentSTTStream()
		if stream == nil {
			return
		}
		stream.AcceptAudioFrame(data)
		return
	}
	if messageType != websocket.TextMessage {
		c.closePolicy("audio socket accepts JSON controls or binary audio")
		return
	}

	msg, err := protocol.ValidateAudioMessage(data)
	if err != nil {
		c.rateLimitedSTTError("invalid", "unknown", err.Error())
		return
	}
	if !c.limiter.Take(audioBucket(msg.Type)) {
		c.sendJSON(map[string]any{"type": "stt:error", "gameId": msg.GameID, "message": "Too many audio messages; slow down"})
		return
	}

	switch msg.Type {
	case "audio:start":
		c.handleAudioStart(msg)
	case "audio:stop":
		c.handleAudioStop(msg)
	case "audio:transcript":
		c.handleTranscript(msg)
	default:
		c.logger.Info("audio control message", "type", msg.Type, "gameId", msg.GameID)
	}
}

func (c *client) handleAudioStart(msg protocol.AudioMessage) {
	c.stopSTTStream()
	if !c.ensureCanSpeak(msg.GameID) {
		return
	}
	actor := c.hub.registry.Get(msg.GameID)
	if actor == nil {
		c.sendJSON(map[string]any{"type": "stt:error", "gameId": msg.GameID, "message": "No active game " + msg.GameID})
		return
	}
	stream, err := c.hub.stt.StartStream(STTStreamOptions{
		GameID:   msg.GameID,
		UserID:   c.userID,
		Keyterms: chessVoiceKeyterms(actor),
		OnTranscript: func(transcript STTTranscript) {
			if transcript.Text == "" {
				return
			}
			if transcript.Final {
				c.handleTranscript(protocol.AudioMessage{Type: "audio:transcript", GameID: msg.GameID, Text: transcript.Text})
				return
			}
			c.sendJSON(map[string]any{"type": "stt:interim", "gameId": msg.GameID, "text": transcript.Text})
		},
		OnError: func(message string) {
			c.sendJSON(map[string]any{"type": "stt:error", "gameId": msg.GameID, "message": message})
		},
	})
	if err != nil {
		c.sendJSON(map[string]any{"type": "stt:error", "gameId": msg.GameID, "message": err.Error()})
		return
	}
	c.setSTTStream(stream)
}

func (c *client) handleAudioStop(msg protocol.AudioMessage) {
	c.stopSTTStream()
}

func (c *client) handleTranscript(msg protocol.AudioMessage) {
	if !c.ensureCanSpeak(msg.GameID) {
		return
	}
	actor := c.hub.registry.Get(msg.GameID)
	if actor == nil {
		return
	}
	c.sendJSON(map[string]any{"type": "stt:interim", "gameId": msg.GameID, "text": msg.Text})
	result := actor.ProposeSpokenMove(c.userID, msg.Text, time.Now())
	if !result.OK {
		c.sendJSON(map[string]any{"type": "stt:error", "gameId": msg.GameID, "message": result.Reason})
		return
	}
	c.stopSTTStream()
	c.sendJSON(map[string]any{"type": "stt:final", "gameId": msg.GameID, "text": msg.Text})
	snapshot := actor.ClockSnapshot(time.Now())
	actor.Broadcast(map[string]any{
		"type":         "move:confirmed",
		"gameId":       actor.ID,
		"move":         result.Move,
		"fen":          actor.FEN(),
		"turn":         actor.Turn(),
		"whiteClockMs": snapshot.WhiteClockMS,
		"blackClockMs": snapshot.BlackClockMS,
	})
}

func (c *client) ensureCanSpeak(gameID string) bool {
	actor := c.hub.registry.Get(gameID)
	if actor == nil {
		c.sendJSON(map[string]any{"type": "stt:error", "gameId": gameID, "message": "No active game " + gameID})
		return false
	}
	color := actor.UserColor(c.userID)
	if color == "" {
		c.sendJSON(map[string]any{"type": "stt:error", "gameId": gameID, "message": "Not a player in this game"})
		return false
	}
	if color != actor.Turn() {
		c.sendJSON(map[string]any{"type": "stt:error", "gameId": gameID, "message": "Not your turn"})
		return false
	}
	return true
}

func (c *client) stopSTTStream() {
	c.sttMu.Lock()
	stream := c.sttStream
	c.sttStream = nil
	c.sttMu.Unlock()
	if stream == nil {
		return
	}
	stream.Close()
}

func (c *client) currentSTTStream() *STTStream {
	c.sttMu.Lock()
	defer c.sttMu.Unlock()
	return c.sttStream
}

func (c *client) setSTTStream(stream *STTStream) {
	c.sttMu.Lock()
	c.sttStream = stream
	c.sttMu.Unlock()
}

func chessVoiceKeyterms(actor *game.Actor) []string {
	keyterms := []string{
		"king", "queen", "rook", "bishop", "knight", "pawn",
		"castle", "kingside", "queenside", "captures", "takes",
		"check", "checkmate",
		"a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8",
		"b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8",
		"c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8",
		"d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8",
		"e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8",
		"f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8",
		"g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8",
		"h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8",
	}
	keyterms = append(keyterms, actor.LegalMoveKeyterms()...)
	if len(keyterms) > 100 {
		keyterms = keyterms[:100]
	}
	return keyterms
}

func (c *client) opponentInfo(mode string) game.OpponentInfo {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return game.OpponentInfo{
		UserID:   c.userID,
		Username: c.username,
		Rating:   c.hub.store.RatingFor(ctx, c.userID, mode),
	}
}

func (c *client) handleQueueJoin(msg protocol.GameMessage) {
	info := c.opponentInfo(msg.Mode)
	result := c.hub.matchmaker.Enqueue(c.userID, c, msg.Mode, game.TimeControl(msg.TimeControl), info)
	if !result.Matched {
		c.sendJSON(map[string]any{
			"type":        "queue:waiting",
			"mode":        msg.Mode,
			"timeControl": msg.TimeControl,
			"queueDepth":  1,
		})
		return
	}
	c.startGame(result.Game, result.Self, result.Other)
}

func (c *client) handleInviteCreate(msg protocol.GameMessage) {
	c.hub.matchmaker.Leave(c.userID)
	info := c.opponentInfo(msg.Mode)
	inviteID := c.hub.invites.Create(c.userID, c, msg.Mode, game.TimeControl(msg.TimeControl), info)
	c.sendJSON(map[string]any{
		"type":        "invite:created",
		"inviteId":    inviteID,
		"mode":        msg.Mode,
		"timeControl": msg.TimeControl,
	})
}

func (c *client) handleInviteJoin(msg protocol.GameMessage) {
	pending, ok := c.hub.invites.Peek(msg.InviteID)
	if !ok {
		c.sendJSON(map[string]any{"type": "error", "code": "invite_not_found", "message": "No pending invite " + msg.InviteID})
		return
	}
	if pending.UserID == c.userID {
		c.sendJSON(map[string]any{"type": "error", "code": "invite_self_join", "message": "You cannot join your own invite"})
		return
	}
	c.hub.matchmaker.Leave(c.userID)
	info := c.opponentInfo(pending.Mode)
	result := c.hub.invites.Join(msg.InviteID, c.userID, c, info)
	if !result.Matched {
		code := "invite_not_found"
		message := "No pending invite " + msg.InviteID
		if result.Reason == "self_join" {
			code = "invite_self_join"
			message = "You cannot join your own invite"
		}
		c.sendJSON(map[string]any{"type": "error", "code": code, "message": message})
		return
	}
	c.startGame(result.Game, result.Self, result.Other)
}

func (c *client) startGame(actor *game.Actor, self game.PairedSide, other game.PairedSide) {
	actor.Attach(self.Color, self.Sender)
	actor.Attach(other.Color, other.Sender)
	c.hub.registry.Register(actor)
	actor.OnEnd(func(ended *game.Actor) {
		c.finalizeAndBroadcast(ended)
	})

	self.Sender.SendJSON(map[string]any{
		"type":        "game:start",
		"gameId":      actor.ID,
		"color":       self.Color,
		"opponent":    self.Opponent,
		"mode":        actor.Mode,
		"timeControl": actor.TimeControl,
	})
	other.Sender.SendJSON(map[string]any{
		"type":        "game:start",
		"gameId":      actor.ID,
		"color":       other.Color,
		"opponent":    other.Opponent,
		"mode":        actor.Mode,
		"timeControl": actor.TimeControl,
	})
	actor.Broadcast(actor.State(time.Now()))
}

func (c *client) handleBotStart(msg protocol.GameMessage) {
	c.hub.matchmaker.Leave(c.userID)
	c.hub.invites.LeaveByUser(c.userID)
	playerColor := msg.Side
	if playerColor == "" {
		playerColor = game.ColorWhite
	}
	botColor := game.OtherColor(playerColor)
	info := c.opponentInfo(msg.Mode)
	strength := msg.Strength
	botRating := float64(800 + strength*70)
	player := game.PlayerSnapshot{UserID: info.UserID, Username: info.Username, RatingBefore: info.Rating}
	bot := game.PlayerSnapshot{UserID: botUserID, Username: "Stockfish Lv " + intString(strength), RatingBefore: botRating}
	white := player
	black := bot
	if playerColor == game.ColorBlack {
		white = bot
		black = player
	}
	actor := game.NewActor(game.NewActorParams{
		ID:          randomID(),
		Mode:        msg.Mode,
		TimeControl: game.TimeControl(msg.TimeControl),
		White:       white,
		Black:       black,
		Now:         time.Now(),
	})
	actor.Attach(playerColor, c)
	c.hub.registry.Register(actor)
	actor.OnEnd(func(ended *game.Actor) {
		c.finalizeAndBroadcast(ended)
	})
	actor.OnMove(func(moved *game.Actor, _ game.MoveRecord) {
		c.scheduleBotMove(moved, strength)
	})
	c.sendJSON(map[string]any{
		"type":   "game:start",
		"gameId": actor.ID,
		"color":  playerColor,
		"opponent": game.OpponentInfo{
			UserID:   botUserID,
			Username: bot.Username,
			Rating:   botRating,
		},
		"mode":        actor.Mode,
		"timeControl": actor.TimeControl,
	})
	actor.Broadcast(actor.State(time.Now()))
	if botColor == game.ColorWhite {
		c.scheduleBotMove(actor, strength)
	}
}

func (c *client) handleGameResume(msg protocol.GameMessage) {
	actor := c.hub.registry.Get(msg.GameID)
	if actor == nil {
		c.sendJSON(map[string]any{"type": "error", "code": "game_not_found", "message": "No active game " + msg.GameID})
		return
	}
	color := actor.UserColor(c.userID)
	if color == "" {
		c.sendJSON(map[string]any{"type": "error", "code": "not_player", "message": "Not a player in this game"})
		return
	}
	actor.Attach(color, c)
	c.sendJSON(map[string]any{
		"type":        "game:start",
		"gameId":      actor.ID,
		"color":       color,
		"opponent":    actor.OpponentInfoForColor(color),
		"mode":        actor.Mode,
		"timeControl": actor.TimeControl,
	})
	actor.Broadcast(actor.State(time.Now()))
}

func (c *client) scheduleBotMove(actor *game.Actor, strength int) {
	if actor.UserColor(botUserID) != actor.Turn() {
		return
	}
	go func() {
		time.Sleep(250 * time.Millisecond)
		if actor.UserColor(botUserID) != actor.Turn() {
			return
		}
		raw, ok := c.hub.bot.BestMoveSAN(actor, strength)
		if !ok {
			return
		}
		result := actor.ProposeMove(botUserID, raw, time.Now())
		if !result.OK {
			return
		}
		snapshot := actor.ClockSnapshot(time.Now())
		actor.Broadcast(map[string]any{
			"type":         "move:confirmed",
			"gameId":       actor.ID,
			"move":         result.Move,
			"fen":          actor.FEN(),
			"turn":         actor.Turn(),
			"whiteClockMs": snapshot.WhiteClockMS,
			"blackClockMs": snapshot.BlackClockMS,
		})
	}()
}

func (c *client) handleMovePropose(msg protocol.GameMessage) {
	actor := c.hub.registry.Get(msg.GameID)
	if actor == nil {
		c.sendJSON(map[string]any{"type": "error", "code": "game_not_found", "message": "No active game " + msg.GameID})
		return
	}
	result := actor.ProposeMove(c.userID, msg.Raw, time.Now())
	if result.OK {
		snapshot := actor.ClockSnapshot(time.Now())
		actor.Broadcast(map[string]any{
			"type":         "move:confirmed",
			"gameId":       actor.ID,
			"move":         result.Move,
			"fen":          actor.FEN(),
			"turn":         actor.Turn(),
			"whiteClockMs": snapshot.WhiteClockMS,
			"blackClockMs": snapshot.BlackClockMS,
		})
		return
	}
	color := actor.UserColor(c.userID)
	if color != "" {
		actor.SendTo(color, map[string]any{
			"type":         "move:rejected",
			"gameId":       actor.ID,
			"reason":       result.Reason,
			"illegalCount": result.IllegalCount,
		})
	}
}

func (c *client) handleResign(msg protocol.GameMessage) {
	actor := c.hub.registry.Get(msg.GameID)
	if actor == nil {
		c.sendJSON(map[string]any{"type": "error", "code": "game_not_found", "message": "No active game " + msg.GameID})
		return
	}
	actor.Resign(c.userID, time.Now())
}

func (c *client) handleOfferDraw(msg protocol.GameMessage) {
	actor := c.hub.registry.Get(msg.GameID)
	if actor == nil {
		c.sendJSON(map[string]any{"type": "error", "code": "game_not_found", "message": "No active game " + msg.GameID})
		return
	}
	if err := actor.OfferDraw(c.userID); err != nil {
		c.sendJSON(map[string]any{"type": "error", "code": "draw_offer_failed", "message": err.Error()})
	}
}

func (c *client) handleAcceptDraw(msg protocol.GameMessage) {
	actor := c.hub.registry.Get(msg.GameID)
	if actor == nil {
		c.sendJSON(map[string]any{"type": "error", "code": "game_not_found", "message": "No active game " + msg.GameID})
		return
	}
	actor.AcceptDraw(c.userID, time.Now())
}

func (c *client) finalizeAndBroadcast(actor *game.Actor) {
	snapshot := actor.Snapshot()
	if snapshot.Result == nil || snapshot.Termination == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	finished, err := c.hub.store.PersistFinishedGame(ctx, actor)
	if err != nil {
		c.logger.Error("persist finished game failed", "gameId", actor.ID, "err", err)
		finished = snapshot
	}
	cancel()
	c.hub.registry.Unregister(actor.ID)
	whiteDelta, blackDelta := ratingDeltas(finished)
	actor.SendTo(game.ColorWhite, map[string]any{
		"type":                "game:end",
		"gameId":              actor.ID,
		"result":              *finished.Result,
		"termination":         *finished.Termination,
		"ratingDeltaSelf":     whiteDelta,
		"ratingDeltaOpponent": blackDelta,
	})
	actor.SendTo(game.ColorBlack, map[string]any{
		"type":                "game:end",
		"gameId":              actor.ID,
		"result":              *finished.Result,
		"termination":         *finished.Termination,
		"ratingDeltaSelf":     blackDelta,
		"ratingDeltaOpponent": whiteDelta,
	})
}

func ratingDeltas(doc game.GameDoc) (int, int) {
	return ratingDelta(doc.White), ratingDelta(doc.Black)
}

func ratingDelta(player game.PlayerSnapshot) int {
	if player.RatingAfter == nil {
		return 0
	}
	return int(*player.RatingAfter - player.RatingBefore)
}

func (c *client) cleanup() {
	c.stopSTTStream()
	if c.userID == "" {
		return
	}
	c.hub.matchmaker.Leave(c.userID)
	c.hub.invites.LeaveByUser(c.userID)
	for _, actor := range c.hub.registry.All() {
		color := actor.UserColor(c.userID)
		if color != "" {
			if actor.Detach(color, c) {
				disconnectedAt := time.Now()
				if actor.MarkDisconnected(color, disconnectedAt) {
					c.scheduleDisconnectForfeit(actor, color, disconnectedAt)
				}
			}
		}
	}
}

func (c *client) scheduleDisconnectForfeit(actor *game.Actor, color string, disconnectedAt time.Time) {
	opponentColor := game.OtherColor(color)
	actor.SendTo(opponentColor, map[string]any{
		"type":                "opponent:disconnected",
		"gameId":              actor.ID,
		"color":               color,
		"reconnectDeadlineMs": disconnectedAt.Add(reconnectGrace).UnixMilli(),
		"reconnectGraceMs":    reconnectGrace.Milliseconds(),
	})
	go func() {
		timer := time.NewTimer(reconnectGrace)
		defer timer.Stop()
		<-timer.C
		if !actor.IsDisconnectedSince(color, disconnectedAt) {
			return
		}
		if actor.ForfeitDisconnected(color, disconnectedAt, time.Now()) {
			c.logger.Info("game forfeited after disconnect grace", "gameId", actor.ID, "color", color)
		}
	}()
}

func (c *client) sendJSON(value any) {
	c.SendJSON(value)
}

func (c *client) SendJSON(value any) bool {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
	if err := c.conn.WriteJSON(value); err != nil {
		c.logger.Warn("write failed", "err", err)
		return false
	}
	return true
}

func (c *client) rateLimitedError(bucket string, code string, message string) {
	if !c.limiter.Take(bucket) {
		c.closePolicy("too many invalid messages")
		return
	}
	c.sendJSON(map[string]any{"type": "error", "code": code, "message": message})
}

func (c *client) rateLimitedSTTError(bucket string, gameID string, message string) {
	if !c.limiter.Take(bucket) {
		c.closePolicy("too many invalid messages")
		return
	}
	c.sendJSON(map[string]any{"type": "stt:error", "gameId": gameID, "message": message})
}

func (c *client) closePolicy(reason string) {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_ = c.conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, reason), time.Now().Add(writeWait))
}

func (c *client) closeTooLarge(reason string) {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_ = c.conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseMessageTooBig, reason), time.Now().Add(writeWait))
}

func newLimiter(kind string) *ratelimit.Limiter {
	if kind == "audio" {
		return ratelimit.NewLimiter(map[string]ratelimit.Config{
			"audio_control": {Capacity: 20, RefillPerSecond: 2},
			"audio_frame":   {Capacity: 80, RefillPerSecond: 40},
			"transcript":    {Capacity: 8, RefillPerSecond: 1},
			"invalid":       {Capacity: 5, RefillPerSecond: 0.2},
		})
	}
	return ratelimit.NewLimiter(map[string]ratelimit.Config{
		"ping":        {Capacity: 20, RefillPerSecond: 10},
		"queue":       {Capacity: 6, RefillPerSecond: 0.2},
		"invite":      {Capacity: 6, RefillPerSecond: 0.2},
		"move":        {Capacity: 20, RefillPerSecond: 2},
		"game_action": {Capacity: 10, RefillPerSecond: 1},
		"bot":         {Capacity: 4, RefillPerSecond: 0.2},
		"invalid":     {Capacity: 5, RefillPerSecond: 0.2},
	})
}

func gameBucket(messageType string) string {
	switch messageType {
	case "ping":
		return "ping"
	case "queue:join", "queue:leave":
		return "queue"
	case "invite:create", "invite:join":
		return "invite"
	case "move:propose":
		return "move"
	case "game:resume", "game:resign", "game:offerDraw", "game:acceptDraw":
		return "game_action"
	case "bot:start":
		return "bot"
	default:
		return "invalid"
	}
}

func audioBucket(messageType string) string {
	switch messageType {
	case "audio:transcript":
		return "transcript"
	default:
		return "audio_control"
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
