package game

import (
	"crypto/rand"
	"errors"
	"math/big"
	"sync"
	"time"

	"github.com/notnil/chess"
)

type Sender interface {
	SendJSON(value any) bool
}

type EndListener func(*Actor)
type MoveListener func(*Actor, MoveRecord)

type Actor struct {
	mu sync.Mutex

	ID          string
	Mode        string
	TimeControl TimeControl
	White       PlayerSnapshot
	Black       PlayerSnapshot
	StartedAt   time.Time

	chessGame *chess.Game
	moves     []MoveRecord

	whiteClockMS int64
	blackClockMS int64
	lastMoveAt   time.Time

	status      string
	result      *string
	termination *string
	endedAt     *time.Time

	illegalCount map[string]int
	drawOfferBy  string
	connections  map[string]Sender
	disconnects  map[string]time.Time

	dirty bool

	endListeners  []EndListener
	moveListeners []MoveListener
}

type NewActorParams struct {
	ID          string
	Mode        string
	TimeControl TimeControl
	White       PlayerSnapshot
	Black       PlayerSnapshot
	Now         time.Time
}

type ClockSnapshot struct {
	WhiteClockMS int64
	BlackClockMS int64
}

type MoveResult struct {
	OK              bool
	Move            MoveRecord
	Reason          string
	IllegalCount    int
	Terminal        bool
	Ambiguous       bool
	CandidateLabels []string
}

func NewActor(params NewActorParams) *Actor {
	initialMS := int64(params.TimeControl.InitialSeconds) * 1000
	return &Actor{
		ID:           params.ID,
		Mode:         params.Mode,
		TimeControl:  params.TimeControl,
		White:        params.White,
		Black:        params.Black,
		StartedAt:    params.Now,
		chessGame:    chess.NewGame(),
		whiteClockMS: initialMS,
		blackClockMS: initialMS,
		lastMoveAt:   params.Now,
		status:       "active",
		illegalCount: map[string]int{ColorWhite: 0, ColorBlack: 0},
		connections:  make(map[string]Sender),
		disconnects:  make(map[string]time.Time),
	}
}

func (a *Actor) OnEnd(listener EndListener) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.endListeners = append(a.endListeners, listener)
}

func (a *Actor) OnMove(listener MoveListener) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.moveListeners = append(a.moveListeners, listener)
}

func (a *Actor) UserColor(userID string) string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.userColorLocked(userID)
}

func (a *Actor) OpponentInfoForColor(color string) OpponentInfo {
	a.mu.Lock()
	defer a.mu.Unlock()
	if color == ColorWhite {
		return OpponentInfo{
			UserID:   a.Black.UserID,
			Username: a.Black.Username,
			Rating:   a.Black.RatingBefore,
		}
	}
	return OpponentInfo{
		UserID:   a.White.UserID,
		Username: a.White.Username,
		Rating:   a.White.RatingBefore,
	}
}

func (a *Actor) userColorLocked(userID string) string {
	if a.White.UserID == userID {
		return ColorWhite
	}
	if a.Black.UserID == userID {
		return ColorBlack
	}
	return ""
}

func (a *Actor) Turn() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.turnLocked()
}

func (a *Actor) FEN() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.chessGame.FEN()
}

func (a *Actor) EngineFEN() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.chessGame.Position().String()
}

func (a *Actor) turnLocked() string {
	if a.chessGame.Position().Turn() == chess.White {
		return ColorWhite
	}
	return ColorBlack
}

func (a *Actor) Attach(color string, sender Sender) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.connections[color] = sender
	delete(a.disconnects, color)
}

func (a *Actor) Detach(color string, sender Sender) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.connections[color] == sender {
		delete(a.connections, color)
		return true
	}
	return false
}

func (a *Actor) MarkDisconnected(color string, now time.Time) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.status != "active" || a.connections[color] != nil {
		return false
	}
	a.disconnects[color] = now
	return true
}

func (a *Actor) IsDisconnectedSince(color string, since time.Time) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	disconnectedAt, ok := a.disconnects[color]
	return a.status == "active" && ok && disconnectedAt.Equal(since) && a.connections[color] == nil
}

func (a *Actor) ForfeitDisconnected(color string, disconnectedAt time.Time, now time.Time) bool {
	a.mu.Lock()
	if a.status != "active" {
		a.mu.Unlock()
		return false
	}
	currentDisconnectedAt, ok := a.disconnects[color]
	if !ok || !currentDisconnectedAt.Equal(disconnectedAt) || a.connections[color] != nil {
		a.mu.Unlock()
		return false
	}
	termination := TerminationDisconnect
	if len(a.moves) == 0 {
		termination = TerminationResignation
	}
	listeners := a.endGameLocked(WinnerFromColor(OtherColor(color)), termination, now)
	a.mu.Unlock()
	a.emitEnd(listeners)
	return true
}

func (a *Actor) Broadcast(value any) {
	a.mu.Lock()
	senders := make([]Sender, 0, len(a.connections))
	for _, sender := range a.connections {
		senders = append(senders, sender)
	}
	a.mu.Unlock()

	for _, sender := range senders {
		go sender.SendJSON(value)
	}
}

func (a *Actor) SendTo(color string, value any) {
	a.mu.Lock()
	sender := a.connections[color]
	a.mu.Unlock()
	if sender != nil {
		sender.SendJSON(value)
	}
}

func (a *Actor) ClockSnapshot(now time.Time) ClockSnapshot {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.clockSnapshotLocked(now)
}

func (a *Actor) clockSnapshotLocked(now time.Time) ClockSnapshot {
	if a.status == "ended" {
		return ClockSnapshot{WhiteClockMS: a.whiteClockMS, BlackClockMS: a.blackClockMS}
	}
	elapsed := now.Sub(a.lastMoveAt).Milliseconds()
	if a.turnLocked() == ColorWhite {
		return ClockSnapshot{WhiteClockMS: max(0, a.whiteClockMS-elapsed), BlackClockMS: a.blackClockMS}
	}
	return ClockSnapshot{WhiteClockMS: a.whiteClockMS, BlackClockMS: max(0, a.blackClockMS-elapsed)}
}

func (a *Actor) State(now time.Time) map[string]any {
	snapshot := a.ClockSnapshot(now)
	a.mu.Lock()
	defer a.mu.Unlock()
	var lastMove any
	if len(a.moves) > 0 {
		lastMove = a.moves[len(a.moves)-1]
	}
	moves := append([]MoveRecord(nil), a.moves...)
	illegal := map[string]int{ColorWhite: a.illegalCount[ColorWhite], ColorBlack: a.illegalCount[ColorBlack]}
	return map[string]any{
		"type":         "game:state",
		"gameId":       a.ID,
		"fen":          a.chessGame.FEN(),
		"turn":         a.turnLocked(),
		"whiteClockMs": snapshot.WhiteClockMS,
		"blackClockMs": snapshot.BlackClockMS,
		"lastMove":     lastMove,
		"moves":        moves,
		"illegalCount": illegal,
	}
}

func (a *Actor) ProposeMove(userID string, raw string, now time.Time) MoveResult {
	a.mu.Lock()
	if a.status != "active" {
		a.mu.Unlock()
		return MoveResult{Reason: "Game is not active"}
	}

	color := a.userColorLocked(userID)
	if color == "" {
		a.mu.Unlock()
		return MoveResult{Reason: "Not a player in this game"}
	}
	if color != a.turnLocked() {
		count := a.illegalCount[color]
		a.mu.Unlock()
		return MoveResult{Reason: "Not your turn", IllegalCount: count}
	}

	remainingBefore := a.clockForLocked(color) - now.Sub(a.lastMoveAt).Milliseconds()
	if remainingBefore <= 0 {
		a.zeroClockLocked(color)
		ended := a.endGameLocked(WinnerFromColor(OtherColor(color)), TerminationTimeout, now)
		count := a.illegalCount[color]
		a.mu.Unlock()
		a.emitEnd(ended)
		return MoveResult{Reason: "Flagged on time", IllegalCount: count, Terminal: true}
	}

	move, err := parseMove(a.chessGame, raw)
	if err != nil {
		a.illegalCount[color]++
		count := a.illegalCount[color]
		var ended bool
		var listeners []EndListener
		if count >= IllegalMoveLimit {
			listeners = a.endGameLocked(WinnerFromColor(OtherColor(color)), TerminationIllegalStrikes, now)
			ended = true
		}
		a.mu.Unlock()
		a.emitEnd(listeners)
		return MoveResult{Reason: "Illegal or unparseable move", IllegalCount: count, Terminal: ended}
	}

	san := chess.AlgebraicNotation{}.Encode(a.chessGame.Position(), move)
	uci := chess.UCINotation{}.Encode(a.chessGame.Position(), move)

	if err := a.chessGame.Move(move); err != nil {
		a.illegalCount[color]++
		count := a.illegalCount[color]
		a.mu.Unlock()
		return MoveResult{Reason: "Illegal or unparseable move", IllegalCount: count}
	}

	newClock := remainingBefore + int64(a.TimeControl.IncrementSeconds)*1000
	a.setClockLocked(color, newClock)
	a.lastMoveAt = now

	record := MoveRecord{
		SAN:          san,
		UCI:          uci,
		Raw:          raw,
		MSFromStart:  now.Sub(a.StartedAt).Milliseconds(),
		WhiteClockMS: a.whiteClockMS,
		BlackClockMS: a.blackClockMS,
	}
	a.moves = append(a.moves, record)
	a.dirty = true

	moveListeners := append([]MoveListener(nil), a.moveListeners...)
	endListeners, terminal := a.checkTerminalLocked(color, now)
	a.mu.Unlock()

	for _, listener := range moveListeners {
		listener(a, record)
	}
	a.emitEnd(endListeners)
	return MoveResult{OK: true, Move: record, Terminal: terminal}
}

func (a *Actor) ProposeSpokenMove(userID string, text string, now time.Time) MoveResult {
	return a.proposeSpokenMove(userID, text, now, true)
}

func (a *Actor) ProposeInterimSpokenMove(userID string, text string, now time.Time) MoveResult {
	return a.proposeSpokenMove(userID, text, now, false)
}

func (a *Actor) proposeSpokenMove(userID string, text string, now time.Time, final bool) MoveResult {
	a.mu.Lock()
	if a.status != "active" {
		a.mu.Unlock()
		return MoveResult{Reason: "Game is not active"}
	}
	color := a.userColorLocked(userID)
	if color == "" {
		a.mu.Unlock()
		return MoveResult{Reason: "Not a player in this game"}
	}
	if color != a.turnLocked() {
		count := a.illegalCount[color]
		a.mu.Unlock()
		return MoveResult{Reason: "Not your turn", IllegalCount: count}
	}
	position := a.chessGame.Position()
	a.mu.Unlock()

	resolution := ResolveSpokenMove(position, text)
	if resolution.Confident && resolution.Move != nil {
		return a.ProposeMove(userID, chess.AlgebraicNotation{}.Encode(position, resolution.Move), now)
	}
	if resolution.Ambiguous {
		return MoveResult{
			Reason:          "Ambiguous move",
			Ambiguous:       true,
			CandidateLabels: resolution.CandidateLabels,
		}
	}
	if !final {
		return MoveResult{Reason: "No complete chess move heard"}
	}
	if !LooksLikeCompleteMoveIntent(text) {
		return MoveResult{Reason: "No chess move heard"}
	}
	return a.ProposeMove(userID, text, now)
}

func (a *Actor) RandomLegalMoveSAN() (string, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	moves := a.chessGame.ValidMoves()
	if len(moves) == 0 {
		return "", false
	}
	idx := 0
	if n, err := rand.Int(rand.Reader, big.NewInt(int64(len(moves)))); err == nil {
		idx = int(n.Int64())
	}
	move := moves[idx]
	return chess.AlgebraicNotation{}.Encode(a.chessGame.Position(), move), true
}

func (a *Actor) LegalMoveKeyterms() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return KeytermsForPosition(a.chessGame.Position())
}

func (a *Actor) Resign(userID string, now time.Time) bool {
	a.mu.Lock()
	if a.status != "active" {
		a.mu.Unlock()
		return false
	}
	color := a.userColorLocked(userID)
	if color == "" {
		a.mu.Unlock()
		return false
	}
	listeners := a.endGameLocked(WinnerFromColor(OtherColor(color)), TerminationResignation, now)
	a.mu.Unlock()
	a.emitEnd(listeners)
	return true
}

func (a *Actor) OfferDraw(userID string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.status != "active" {
		return errors.New("game is not active")
	}
	color := a.userColorLocked(userID)
	if color == "" {
		return errors.New("not a player in this game")
	}
	a.drawOfferBy = color
	return nil
}

func (a *Actor) AcceptDraw(userID string, now time.Time) bool {
	a.mu.Lock()
	if a.status != "active" {
		a.mu.Unlock()
		return false
	}
	color := a.userColorLocked(userID)
	if color == "" || a.drawOfferBy == "" || a.drawOfferBy == color {
		a.mu.Unlock()
		return false
	}
	listeners := a.endGameLocked(ResultDraw, TerminationAgreedDraw, now)
	a.mu.Unlock()
	a.emitEnd(listeners)
	return true
}

func (a *Actor) Tick(now time.Time) bool {
	a.mu.Lock()
	if a.status != "active" {
		a.mu.Unlock()
		return false
	}
	turn := a.turnLocked()
	if a.clockForLocked(turn)-now.Sub(a.lastMoveAt).Milliseconds() > 0 {
		a.mu.Unlock()
		return false
	}
	a.zeroClockLocked(turn)
	listeners := a.endGameLocked(WinnerFromColor(OtherColor(turn)), TerminationTimeout, now)
	a.mu.Unlock()
	go a.emitEnd(listeners)
	return true
}

func (a *Actor) Snapshot() GameDoc {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.snapshotLocked()
}

func (a *Actor) snapshotLocked() GameDoc {
	illegal := map[string]int{ColorWhite: a.illegalCount[ColorWhite], ColorBlack: a.illegalCount[ColorBlack]}
	moves := append([]MoveRecord(nil), a.moves...)
	status := GameStatusActive
	if a.status == "ended" {
		status = GameStatusEnded
	}
	return GameDoc{
		ID:           a.ID,
		Status:       status,
		Mode:         a.Mode,
		TimeControl:  a.TimeControl,
		White:        a.White,
		Black:        a.Black,
		Result:       a.result,
		Termination:  a.termination,
		PGN:          a.chessGame.String(),
		Moves:        moves,
		IllegalCount: illegal,
		WhiteClockMS: a.whiteClockMS,
		BlackClockMS: a.blackClockMS,
		LastMoveAt:   a.lastMoveAt,
		DrawOfferBy:  a.drawOfferBy,
		StartedAt:    a.StartedAt,
		EndedAt:      a.endedAt,
	}
}

func (a *Actor) IsActive() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.status == "active"
}

func (a *Actor) TakeDirty() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.dirty {
		return false
	}
	a.dirty = false
	return true
}

func NewActorFromDoc(doc GameDoc) (*Actor, error) {
	chessGame := chess.NewGame()
	for _, m := range doc.Moves {
		raw := m.UCI
		if raw == "" {
			raw = m.SAN
		}
		if raw == "" {
			raw = m.Raw
		}
		move, err := parseMove(chessGame, raw)
		if err != nil {
			return nil, err
		}
		if err := chessGame.Move(move); err != nil {
			return nil, err
		}
	}
	status := "active"
	if doc.Status == GameStatusEnded || doc.Result != nil {
		status = "ended"
	}
	illegal := map[string]int{ColorWhite: 0, ColorBlack: 0}
	for color, count := range doc.IllegalCount {
		illegal[color] = count
	}
	lastMoveAt := doc.LastMoveAt
	if lastMoveAt.IsZero() {
		lastMoveAt = doc.StartedAt
	}
	whiteClock := doc.WhiteClockMS
	blackClock := doc.BlackClockMS
	if whiteClock == 0 && blackClock == 0 {
		initial := int64(doc.TimeControl.InitialSeconds) * 1000
		whiteClock = initial
		blackClock = initial
	}
	return &Actor{
		ID:           doc.ID,
		Mode:         doc.Mode,
		TimeControl:  doc.TimeControl,
		White:        doc.White,
		Black:        doc.Black,
		StartedAt:    doc.StartedAt,
		chessGame:    chessGame,
		moves:        append([]MoveRecord(nil), doc.Moves...),
		whiteClockMS: whiteClock,
		blackClockMS: blackClock,
		lastMoveAt:   lastMoveAt,
		status:       status,
		result:       doc.Result,
		termination:  doc.Termination,
		endedAt:      doc.EndedAt,
		illegalCount: illegal,
		drawOfferBy:  doc.DrawOfferBy,
		connections:  make(map[string]Sender),
		disconnects:  make(map[string]time.Time),
	}, nil
}

func (a *Actor) clockForLocked(color string) int64 {
	if color == ColorWhite {
		return a.whiteClockMS
	}
	return a.blackClockMS
}

func (a *Actor) setClockLocked(color string, value int64) {
	if color == ColorWhite {
		a.whiteClockMS = max(0, value)
		return
	}
	a.blackClockMS = max(0, value)
}

func (a *Actor) zeroClockLocked(color string) {
	a.setClockLocked(color, 0)
}

func (a *Actor) checkTerminalLocked(mover string, now time.Time) ([]EndListener, bool) {
	outcome := a.chessGame.Outcome()
	if outcome == chess.NoOutcome {
		return nil, false
	}
	method := a.chessGame.Method()
	if outcome == chess.WhiteWon {
		return a.endGameLocked(ResultWhite, terminationFromMethod(method), now), true
	}
	if outcome == chess.BlackWon {
		return a.endGameLocked(ResultBlack, terminationFromMethod(method), now), true
	}
	_ = mover
	return a.endGameLocked(ResultDraw, terminationFromMethod(method), now), true
}

func (a *Actor) endGameLocked(result string, termination string, now time.Time) []EndListener {
	if a.status == "ended" {
		return nil
	}
	a.status = "ended"
	a.result = &result
	a.termination = &termination
	a.endedAt = &now
	return append([]EndListener(nil), a.endListeners...)
}

func (a *Actor) emitEnd(listeners []EndListener) {
	for _, listener := range listeners {
		listener(a)
	}
}

func terminationFromMethod(method chess.Method) string {
	switch method {
	case chess.Checkmate:
		return TerminationCheckmate
	case chess.Stalemate:
		return TerminationStalemate
	case chess.ThreefoldRepetition:
		return TerminationThreefoldRepetition
	case chess.FiftyMoveRule:
		return TerminationFiftyMoveRule
	case chess.InsufficientMaterial:
		return TerminationInsufficientMaterial
	default:
		return TerminationStalemate
	}
}

func parseMove(g *chess.Game, raw string) (*chess.Move, error) {
	notations := []chess.Notation{
		chess.AlgebraicNotation{},
		chess.UCINotation{},
	}
	var lastErr error
	for _, notation := range notations {
		move, err := notation.Decode(g.Position(), raw)
		if err == nil {
			return move, nil
		}
		lastErr = err
	}
	return nil, lastErr
}
