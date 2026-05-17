package game

import (
	"sync"
	"testing"
	"time"
)

type fakeSender struct {
	id string
}

func (f *fakeSender) SendJSON(value any) bool { return true }

func TestEnqueueQueuesAloneWaiter(t *testing.T) {
	m := NewMatchmaker()
	tc := TimeControl{InitialSeconds: 300}
	result := m.Enqueue("u1", &fakeSender{"a"}, ModeEasy, tc, OpponentInfo{UserID: "u1", Rating: 1200})
	if result.Matched {
		t.Fatal("expected no match for single user")
	}
	if got := m.Depth(ModeEasy, tc); got != 1 {
		t.Fatalf("Depth = %d, want 1", got)
	}
	if got := m.TotalDepth(); got != 1 {
		t.Fatalf("TotalDepth = %d, want 1", got)
	}
}

func TestEnqueuePairsInstantWithinWindow(t *testing.T) {
	m := NewMatchmaker()
	tc := TimeControl{InitialSeconds: 300}
	m.Enqueue("u1", &fakeSender{"a"}, ModeEasy, tc, OpponentInfo{UserID: "u1", Rating: 1200})
	result := m.Enqueue("u2", &fakeSender{"b"}, ModeEasy, tc, OpponentInfo{UserID: "u2", Rating: 1230})
	if !result.Matched {
		t.Fatal("expected match for users within initial 50 window")
	}
	if got := m.Depth(ModeEasy, tc); got != 0 {
		t.Fatalf("queue should be empty after pairing, got Depth = %d", got)
	}
}

func TestEnqueueDoesNotPairOutsideWindow(t *testing.T) {
	m := NewMatchmaker()
	tc := TimeControl{InitialSeconds: 300}
	m.Enqueue("u1", &fakeSender{"a"}, ModeEasy, tc, OpponentInfo{UserID: "u1", Rating: 1200})
	result := m.Enqueue("u2", &fakeSender{"b"}, ModeEasy, tc, OpponentInfo{UserID: "u2", Rating: 1500})
	if result.Matched {
		t.Fatal("expected NO instant match for 300-point gap with base window of 50")
	}
	if got := m.Depth(ModeEasy, tc); got != 2 {
		t.Fatalf("Depth = %d, want 2", got)
	}
}

func TestRatingWindowExpansion(t *testing.T) {
	cases := []struct {
		elapsed time.Duration
		want    float64
	}{
		{0, 50},
		{9 * time.Second, 50},
		{10 * time.Second, 100},
		{20 * time.Second, 150},
		{60 * time.Second, 350},
		{70 * time.Second, 400},
		{200 * time.Second, 400},
	}
	for _, c := range cases {
		if got := ratingWindow(c.elapsed); got != c.want {
			t.Errorf("ratingWindow(%v) = %v, want %v", c.elapsed, got, c.want)
		}
	}
}

func TestTickerPairsExpandedWindow(t *testing.T) {
	m := NewMatchmaker()
	tc := TimeControl{InitialSeconds: 300}
	var mu sync.Mutex
	var matches []MatchResult
	m.SetMatchHandler(func(r MatchResult) {
		mu.Lock()
		defer mu.Unlock()
		matches = append(matches, r)
	})

	m.Enqueue("u1", &fakeSender{"a"}, ModeEasy, tc, OpponentInfo{UserID: "u1", Rating: 1200})
	m.Enqueue("u2", &fakeSender{"b"}, ModeEasy, tc, OpponentInfo{UserID: "u2", Rating: 1280})

	if got := m.Depth(ModeEasy, tc); got != 2 {
		t.Fatalf("Depth before ticker = %d, want 2", got)
	}

	m.mu.Lock()
	for _, w := range m.pools[poolKey(ModeEasy, tc)] {
		w.JoinedAt = time.Now().Add(-12 * time.Second)
	}
	m.mu.Unlock()

	m.runMatching()

	mu.Lock()
	defer mu.Unlock()
	if len(matches) != 1 {
		t.Fatalf("expected 1 ticker-driven match, got %d", len(matches))
	}
	if got := m.Depth(ModeEasy, tc); got != 0 {
		t.Fatalf("queue should be empty after ticker match, got %d", got)
	}
}

func TestLeaveRemovesUser(t *testing.T) {
	m := NewMatchmaker()
	tc := TimeControl{InitialSeconds: 300}
	m.Enqueue("u1", &fakeSender{"a"}, ModeEasy, tc, OpponentInfo{UserID: "u1", Rating: 1200})
	m.Leave("u1")
	if got := m.Depth(ModeEasy, tc); got != 0 {
		t.Fatalf("Depth after Leave = %d, want 0", got)
	}
}

func TestEnqueueReassignsUserBetweenPools(t *testing.T) {
	m := NewMatchmaker()
	tcA := TimeControl{InitialSeconds: 300}
	tcB := TimeControl{InitialSeconds: 600}
	m.Enqueue("u1", &fakeSender{"a"}, ModeEasy, tcA, OpponentInfo{UserID: "u1", Rating: 1200})
	m.Enqueue("u1", &fakeSender{"a"}, ModeEasy, tcB, OpponentInfo{UserID: "u1", Rating: 1200})

	if got := m.Depth(ModeEasy, tcA); got != 0 {
		t.Fatalf("old pool should be empty, got %d", got)
	}
	if got := m.Depth(ModeEasy, tcB); got != 1 {
		t.Fatalf("new pool depth = %d, want 1", got)
	}
}

func TestTickerPairsClosestRating(t *testing.T) {
	m := NewMatchmaker()
	tc := TimeControl{InitialSeconds: 300}
	var matches []MatchResult
	m.SetMatchHandler(func(r MatchResult) { matches = append(matches, r) })

	m.Enqueue("low", &fakeSender{"low"}, ModeEasy, tc, OpponentInfo{UserID: "low", Rating: 1000})
	m.Enqueue("mid", &fakeSender{"mid"}, ModeEasy, tc, OpponentInfo{UserID: "mid", Rating: 1100})
	m.Enqueue("high", &fakeSender{"high"}, ModeEasy, tc, OpponentInfo{UserID: "high", Rating: 1200})

	m.mu.Lock()
	for _, w := range m.pools[poolKey(ModeEasy, tc)] {
		w.JoinedAt = time.Now().Add(-30 * time.Second)
	}
	m.mu.Unlock()

	m.runMatching()

	if len(matches) != 1 {
		t.Fatalf("expected exactly 1 match (3 waiters, 1 pair, 1 leftover), got %d", len(matches))
	}
	got := matches[0]
	pair := map[string]bool{got.Self.UserID: true, got.Other.UserID: true}
	if !(pair["low"] && pair["mid"]) && !(pair["mid"] && pair["high"]) {
		t.Fatalf("expected adjacent rating pair, got %v", pair)
	}
}
