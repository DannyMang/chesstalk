package metrics

import (
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

type Metrics struct {
	activeWS       atomic.Int64
	deepgramErr    *slidingCounter
	mongoDurations *ringBuffer
	tickerLagMS    atomic.Int64
}

type Snapshot struct {
	ActiveWS         int64 `json:"active_ws"`
	ActiveGames      int64 `json:"active_games"`
	QueueDepth       int64 `json:"queue_depth"`
	DeepgramErrors1m int64 `json:"deepgram_errors_1m"`
	MongoP95MS       int64 `json:"mongo_p95_ms"`
	TickerLagMS      int64 `json:"ticker_lag_ms"`
}

func New() *Metrics {
	return &Metrics{
		deepgramErr:    newSlidingCounter(time.Minute),
		mongoDurations: newRingBuffer(200),
	}
}

func (m *Metrics) IncWS()                         { m.activeWS.Add(1) }
func (m *Metrics) DecWS()                         { m.activeWS.Add(-1) }
func (m *Metrics) IncDeepgramError()              { m.deepgramErr.add() }
func (m *Metrics) RecordMongo(d time.Duration)    { m.mongoDurations.add(d) }
func (m *Metrics) SetTickerLagMS(lagMS int64)     { m.tickerLagMS.Store(lagMS) }

func (m *Metrics) Snapshot(activeGames, queueDepth int64) Snapshot {
	return Snapshot{
		ActiveWS:         m.activeWS.Load(),
		ActiveGames:      activeGames,
		QueueDepth:       queueDepth,
		DeepgramErrors1m: m.deepgramErr.count(),
		MongoP95MS:       m.mongoDurations.p95Millis(),
		TickerLagMS:      m.tickerLagMS.Load(),
	}
}

type slidingCounter struct {
	mu     sync.Mutex
	events []time.Time
	window time.Duration
}

func newSlidingCounter(window time.Duration) *slidingCounter {
	return &slidingCounter{window: window}
}

func (s *slidingCounter) add() {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-s.window)
	keep := s.events[:0]
	for _, t := range s.events {
		if t.After(cutoff) {
			keep = append(keep, t)
		}
	}
	s.events = append(keep, now)
}

func (s *slidingCounter) count() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	cutoff := time.Now().Add(-s.window)
	var n int64
	for _, t := range s.events {
		if t.After(cutoff) {
			n++
		}
	}
	return n
}

type ringBuffer struct {
	mu      sync.Mutex
	samples []time.Duration
	pos     int
	filled  bool
}

func newRingBuffer(size int) *ringBuffer {
	return &ringBuffer{samples: make([]time.Duration, size)}
}

func (r *ringBuffer) add(d time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.samples[r.pos] = d
	r.pos = (r.pos + 1) % len(r.samples)
	if r.pos == 0 {
		r.filled = true
	}
}

func (r *ringBuffer) p95Millis() int64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := len(r.samples)
	if !r.filled {
		n = r.pos
	}
	if n == 0 {
		return 0
	}
	copied := make([]time.Duration, n)
	copy(copied, r.samples[:n])
	sort.Slice(copied, func(i, j int) bool { return copied[i] < copied[j] })
	idx := int(float64(n) * 0.95)
	if idx >= n {
		idx = n - 1
	}
	return copied[idx].Milliseconds()
}
