package game

import (
	"sync"
	"time"
)

type Registry struct {
	mu          sync.RWMutex
	games       map[string]*Actor
	stopCh      chan struct{}
	onTickerLag func(lagMS int64)
}

func NewRegistry() *Registry {
	return &Registry{games: make(map[string]*Actor)}
}

func (r *Registry) Register(actor *Actor) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.games[actor.ID] = actor
}

func (r *Registry) Unregister(gameID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.games, gameID)
}

func (r *Registry) Get(gameID string) *Actor {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.games[gameID]
}

func (r *Registry) All() []*Actor {
	r.mu.RLock()
	defer r.mu.RUnlock()
	games := make([]*Actor, 0, len(r.games))
	for _, actor := range r.games {
		games = append(games, actor)
	}
	return games
}

func (r *Registry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.games)
}

func (r *Registry) SetTickerLagHandler(fn func(lagMS int64)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.onTickerLag = fn
}

func (r *Registry) StartTicker() {
	r.mu.Lock()
	if r.stopCh != nil {
		r.mu.Unlock()
		return
	}
	stopCh := make(chan struct{})
	r.stopCh = stopCh
	r.mu.Unlock()

	go func() {
		interval := time.Second
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		expected := time.Now().Add(interval)
		for {
			select {
			case fired := <-ticker.C:
				lag := fired.Sub(expected).Milliseconds()
				if lag < 0 {
					lag = 0
				}
				r.mu.RLock()
				handler := r.onTickerLag
				r.mu.RUnlock()
				if handler != nil {
					handler(lag)
				}
				for _, actor := range r.All() {
					actor.Tick(fired)
				}
				expected = fired.Add(interval)
			case <-stopCh:
				return
			}
		}
	}()
}

func (r *Registry) StopTicker() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.stopCh == nil {
		return
	}
	close(r.stopCh)
	r.stopCh = nil
}
