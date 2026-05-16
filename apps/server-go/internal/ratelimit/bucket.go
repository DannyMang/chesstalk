package ratelimit

import (
	"sync"
	"time"
)

type Config struct {
	Capacity        float64
	RefillPerSecond float64
}

type Bucket struct {
	mu        sync.Mutex
	config    Config
	tokens    float64
	updatedAt time.Time
}

func NewBucket(config Config) *Bucket {
	now := time.Now()
	return &Bucket{
		config:    config,
		tokens:    config.Capacity,
		updatedAt: now,
	}
}

func (b *Bucket) Take() bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	now := time.Now()
	elapsed := now.Sub(b.updatedAt).Seconds()
	b.tokens = min(b.config.Capacity, b.tokens+elapsed*b.config.RefillPerSecond)
	b.updatedAt = now

	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

type Limiter struct {
	buckets map[string]*Bucket
}

func NewLimiter(configs map[string]Config) *Limiter {
	buckets := make(map[string]*Bucket, len(configs))
	for key, config := range configs {
		buckets[key] = NewBucket(config)
	}
	return &Limiter{buckets: buckets}
}

func (l *Limiter) Take(key string) bool {
	bucket, ok := l.buckets[key]
	if !ok {
		return false
	}
	return bucket.Take()
}
