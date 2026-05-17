package game

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math"
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

type MatchHandler func(MatchResult)

type Matchmaker struct {
	mu         sync.Mutex
	pools      map[string][]*Waiter
	userToPool map[string]string
	onMatch    MatchHandler
	stopCh     chan struct{}
}

func NewMatchmaker() *Matchmaker {
	return &Matchmaker{
		pools:      make(map[string][]*Waiter),
		userToPool: make(map[string]string),
	}
}

func (m *Matchmaker) SetMatchHandler(h MatchHandler) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.onMatch = h
}

func (m *Matchmaker) Enqueue(userID string, sender Sender, mode string, tc TimeControl, info OpponentInfo) MatchResult {
	m.mu.Lock()
	defer m.mu.Unlock()

	if existing := m.userToPool[userID]; existing != "" {
		m.removeFromPoolLocked(userID, existing)
	}

	key := poolKey(mode, tc)
	queue := m.pools[key]
	newcomer := &Waiter{
		UserID:       userID,
		Sender:       sender,
		OpponentInfo: info,
		Mode:         mode,
		TimeControl:  tc,
		JoinedAt:     time.Now(),
	}

	if len(queue) > 0 {
		best := -1
		bestDelta := math.MaxFloat64
		newcomerWindow := ratingWindow(0)
		for i, w := range queue {
			peerWindow := ratingWindow(time.Since(w.JoinedAt))
			tolerance := math.Min(newcomerWindow, peerWindow)
			delta := math.Abs(w.OpponentInfo.Rating - newcomer.OpponentInfo.Rating)
			if delta <= tolerance && delta < bestDelta {
				best = i
				bestDelta = delta
			}
		}
		if best >= 0 {
			peer := queue[best]
			m.pools[key] = append(queue[:best], queue[best+1:]...)
			delete(m.userToPool, peer.UserID)
			return pairPlayers(newcomer, peer, mode, tc)
		}
	}

	m.pools[key] = append(queue, newcomer)
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
	m.removeFromPoolLocked(userID, key)
}

func (m *Matchmaker) removeFromPoolLocked(userID, key string) {
	queue := m.pools[key]
	for i, w := range queue {
		if w.UserID == userID {
			m.pools[key] = append(queue[:i], queue[i+1:]...)
			break
		}
	}
	delete(m.userToPool, userID)
}

func (m *Matchmaker) Depth(mode string, tc TimeControl) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.pools[poolKey(mode, tc)])
}

func (m *Matchmaker) TotalDepth() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	total := 0
	for _, q := range m.pools {
		total += len(q)
	}
	return total
}

func (m *Matchmaker) StartTicker(interval time.Duration) {
	m.mu.Lock()
	if m.stopCh != nil {
		m.mu.Unlock()
		return
	}
	stop := make(chan struct{})
	m.stopCh = stop
	m.mu.Unlock()

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				m.runMatching()
			case <-stop:
				return
			}
		}
	}()
}

func (m *Matchmaker) StopTicker() {
	m.mu.Lock()
	if m.stopCh == nil {
		m.mu.Unlock()
		return
	}
	close(m.stopCh)
	m.stopCh = nil
	m.mu.Unlock()
}

func (m *Matchmaker) runMatching() {
	m.mu.Lock()
	handler := m.onMatch
	var matches []MatchResult
	for key, queue := range m.pools {
		for {
			a, b, idxA, idxB := findBestPairLocked(queue)
			if a == nil {
				break
			}
			matches = append(matches, pairPlayers(a, b, a.Mode, a.TimeControl))
			delete(m.userToPool, a.UserID)
			delete(m.userToPool, b.UserID)
			high, low := idxA, idxB
			if high < low {
				high, low = low, high
			}
			queue = append(queue[:high], queue[high+1:]...)
			queue = append(queue[:low], queue[low+1:]...)
		}
		m.pools[key] = queue
	}
	m.mu.Unlock()

	if handler != nil {
		for _, match := range matches {
			handler(match)
		}
	}
}

func findBestPairLocked(queue []*Waiter) (*Waiter, *Waiter, int, int) {
	now := time.Now()
	for i := 0; i < len(queue); i++ {
		a := queue[i]
		windowA := ratingWindow(now.Sub(a.JoinedAt))
		bestIdx := -1
		bestDelta := math.MaxFloat64
		for j := i + 1; j < len(queue); j++ {
			b := queue[j]
			windowB := ratingWindow(now.Sub(b.JoinedAt))
			tolerance := math.Min(windowA, windowB)
			delta := math.Abs(a.OpponentInfo.Rating - b.OpponentInfo.Rating)
			if delta <= tolerance && delta < bestDelta {
				bestIdx = j
				bestDelta = delta
			}
		}
		if bestIdx >= 0 {
			return a, queue[bestIdx], i, bestIdx
		}
	}
	return nil, nil, -1, -1
}

func ratingWindow(elapsed time.Duration) float64 {
	expansions := int64(elapsed.Seconds()) / 10
	window := 50.0 + 50.0*float64(expansions)
	if window > 400 {
		window = 400
	}
	return window
}

func poolKey(mode string, tc TimeControl) string {
	return fmt.Sprintf("%s|%d+%d", mode, tc.InitialSeconds, tc.IncrementSeconds)
}

func pairPlayers(newcomer, peer *Waiter, mode string, tc TimeControl) MatchResult {
	newcomerIsWhite := randomBool()
	whiteInfo := newcomer.OpponentInfo
	blackInfo := peer.OpponentInfo
	newcomerColor := ColorWhite
	peerColor := ColorBlack

	if !newcomerIsWhite {
		whiteInfo = peer.OpponentInfo
		blackInfo = newcomer.OpponentInfo
		newcomerColor = ColorBlack
		peerColor = ColorWhite
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
			UserID:   newcomer.UserID,
			Sender:   newcomer.Sender,
			Color:    newcomerColor,
			Opponent: peer.OpponentInfo,
		},
		Other: PairedSide{
			UserID:   peer.UserID,
			Sender:   peer.Sender,
			Color:    peerColor,
			Opponent: newcomer.OpponentInfo,
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
