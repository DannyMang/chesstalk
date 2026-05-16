package game

import (
	"sync"
	"time"
)

type Registry struct {
	mu     sync.RWMutex
	games  map[string]*Actor
	stopCh chan struct{}
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
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				now := time.Now()
				for _, actor := range r.All() {
					actor.Tick(now)
				}
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
