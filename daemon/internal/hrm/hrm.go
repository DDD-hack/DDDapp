package hrm

import (
	"sync"
	"time"
)

const windowDuration = 10 * time.Second

type sample struct {
	bpm       int
	recordedAt time.Time
}

type Buffer struct {
	mu      sync.Mutex
	samples []sample
}

func (b *Buffer) Add(bpm int) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.samples = append(b.samples, sample{bpm: bpm, recordedAt: time.Now()})
}

// Average returns the average BPM of samples within the last 10 seconds.
// Returns (0, false) when no recent samples exist (stale).
func (b *Buffer) Average() (int, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()

	cutoff := time.Now().Add(-windowDuration)
	var recent []sample
	for _, s := range b.samples {
		if s.recordedAt.After(cutoff) {
			recent = append(recent, s)
		}
	}
	b.samples = recent

	if len(recent) == 0 {
		return 0, false
	}

	sum := 0
	for _, s := range recent {
		sum += s.bpm
	}
	return sum / len(recent), true
}
