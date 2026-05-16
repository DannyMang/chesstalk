package game

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

type Waiter struct {
	UserID       string
	Sender       Sender
	OpponentInfo OpponentInfo
	Mode         string
	TimeControl  TimeControl
	JoinedAt     time.Time
}

type PairedSide struct {
	UserID   string
	Sender   Sender
	Color    string
	Opponent OpponentInfo
}

type MatchResult struct {
	Matched bool
	Game    *Actor
	Self    PairedSide
	Other   PairedSide
}

type Matchmaker struct {
	mu         sync.Mutex
	pools      map[string]Waiter
	userToPool map[string]string
}

func NewMatchmaker() *Matchmaker {
	return &Matchmaker{
		pools:      make(map[string]Waiter),
		userToPool: make(map[string]string),
	}
}

func (m *Matchmaker) Enqueue(userID string, sender Sender, mode string, tc TimeControl, info OpponentInfo) MatchResult {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := poolKey(mode, tc)
	waiter, ok := m.pools[key]
	if ok && waiter.UserID != userID {
		delete(m.pools, key)
		delete(m.userToPool, waiter.UserID)
		return pairPlayers(userID, sender, info, waiter, mode, tc)
	}

	if ok && waiter.UserID == userID {
		delete(m.pools, key)
		delete(m.userToPool, userID)
	}
	if existing := m.userToPool[userID]; existing != "" && existing != key {
		delete(m.pools, existing)
		delete(m.userToPool, userID)
	}

	m.pools[key] = Waiter{
		UserID:       userID,
		Sender:       sender,
		OpponentInfo: info,
		Mode:         mode,
		TimeControl:  tc,
		JoinedAt:     time.Now(),
	}
	m.userToPool[userID] = key
	return MatchResult{}
}

func (m *Matchmaker) Leave(userID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := m.userToPool[userID]
	if key == "" {
		return
	}
	waiter, ok := m.pools[key]
	if ok && waiter.UserID == userID {
		delete(m.pools, key)
	}
	delete(m.userToPool, userID)
}

func (m *Matchmaker) Depth(mode string, tc TimeControl) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.pools[poolKey(mode, tc)]; ok {
		return 1
	}
	return 0
}

func (m *Matchmaker) TotalDepth() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.pools)
}

func poolKey(mode string, tc TimeControl) string {
	return fmt.Sprintf("%s|%d+%d", mode, tc.InitialSeconds, tc.IncrementSeconds)
}

func pairPlayers(userID string, sender Sender, info OpponentInfo, waiter Waiter, mode string, tc TimeControl) MatchResult {
	newcomerIsWhite := randomBool()
	whiteInfo := info
	blackInfo := waiter.OpponentInfo
	newcomerColor := ColorWhite
	waiterColor := ColorBlack

	if !newcomerIsWhite {
		whiteInfo = waiter.OpponentInfo
		blackInfo = info
		newcomerColor = ColorBlack
		waiterColor = ColorWhite
	}

	actor := NewActor(NewActorParams{
		ID:          randomID(),
		Mode:        mode,
		TimeControl: tc,
		White: PlayerSnapshot{
			UserID:       whiteInfo.UserID,
			Username:     whiteInfo.Username,
			RatingBefore: whiteInfo.Rating,
		},
		Black: PlayerSnapshot{
			UserID:       blackInfo.UserID,
			Username:     blackInfo.Username,
			RatingBefore: blackInfo.Rating,
		},
		Now: time.Now(),
	})

	return MatchResult{
		Matched: true,
		Game:    actor,
		Self: PairedSide{
			UserID:   userID,
			Sender:   sender,
			Color:    newcomerColor,
			Opponent: waiter.OpponentInfo,
		},
		Other: PairedSide{
			UserID:   waiter.UserID,
			Sender:   waiter.Sender,
			Color:    waiterColor,
			Opponent: info,
		},
	}
}

func randomID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b[:])
}

func randomBool() bool {
	var b [1]byte
	if _, err := rand.Read(b[:]); err != nil {
		return time.Now().UnixNano()%2 == 0
	}
	return b[0]%2 == 0
}
