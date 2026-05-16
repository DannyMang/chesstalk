package ws

import (
	"log/slog"
	"strconv"
	"sync"
	"time"

	"github.com/DannyMang/chesstalk/apps/server-go/internal/config"
	"github.com/DannyMang/chesstalk/apps/server-go/internal/game"
	"github.com/notnil/chess"
	"github.com/notnil/chess/uci"
)

type BotEngine struct {
	path   string
	logger *slog.Logger

	mu     sync.Mutex
	engine *uci.Engine
}

func NewBotEngine(cfg config.Config, logger *slog.Logger) *BotEngine {
	return &BotEngine{
		path:   cfg.StockfishPath,
		logger: logger,
	}
}

func (b *BotEngine) BestMoveSAN(actor *game.Actor, strength int) (string, bool) {
	fen := actor.EngineFEN()
	bestMove, err := b.bestMove(fen, strength)
	if err != nil {
		b.logger.Warn("stockfish move failed, using legal fallback", "gameId", actor.ID, "err", err)
		return actor.RandomLegalMoveSAN()
	}

	position := &chess.Position{}
	if err := position.UnmarshalText([]byte(fen)); err != nil {
		b.logger.Warn("stockfish position decode failed, using legal fallback", "gameId", actor.ID, "err", err)
		return actor.RandomLegalMoveSAN()
	}
	for _, legal := range position.ValidMoves() {
		if legal.String() == bestMove.String() {
			return chess.AlgebraicNotation{}.Encode(position, legal), true
		}
	}

	b.logger.Warn("stockfish returned illegal move, using legal fallback", "gameId", actor.ID, "move", bestMove.String())
	return actor.RandomLegalMoveSAN()
}

func (b *BotEngine) bestMove(fen string, strength int) (*chess.Move, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	engine, err := b.ensureEngineLocked()
	if err != nil {
		return nil, err
	}

	position := &chess.Position{}
	if err := position.UnmarshalText([]byte(fen)); err != nil {
		return nil, err
	}
	if err := engine.Run(
		uci.CmdSetOption{Name: "Skill Level", Value: strconv.Itoa(clampStrength(strength))},
		uci.CmdPosition{Position: position},
		uci.CmdGo{MoveTime: moveTimeForStrength(strength)},
	); err != nil {
		_ = engine.Close()
		b.engine = nil
		return nil, err
	}
	return engine.SearchResults().BestMove, nil
}

func (b *BotEngine) ensureEngineLocked() (*uci.Engine, error) {
	if b.engine != nil {
		return b.engine, nil
	}
	engine, err := uci.New(b.path)
	if err != nil {
		return nil, err
	}
	if err := engine.Run(
		uci.CmdUCI,
		uci.CmdIsReady,
		uci.CmdSetOption{Name: "Threads", Value: "1"},
		uci.CmdSetOption{Name: "Hash", Value: "32"},
		uci.CmdUCINewGame,
		uci.CmdIsReady,
	); err != nil {
		_ = engine.Close()
		return nil, err
	}
	b.engine = engine
	return engine, nil
}

func moveTimeForStrength(strength int) time.Duration {
	strength = clampStrength(strength)
	return time.Duration(75+strength*25) * time.Millisecond
}

func clampStrength(strength int) int {
	if strength < 0 {
		return 0
	}
	if strength > 20 {
		return 20
	}
	return strength
}
