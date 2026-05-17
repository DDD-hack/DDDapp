package hrm

import (
	"fmt"
	"sync"
	"time"
)

const windowDuration = 10 * time.Second

type sample struct {
	bpm        int
	recordedAt time.Time
}

type Buffer struct {
	mu      sync.Mutex
	samples []sample
	now     func() time.Time // テスト時に差し替えられる時計
}

func NewBuffer() *Buffer {
	return &Buffer{now: time.Now}
}

// nowTime returns b.now() with a nil-safe fallback to time.Now.
func (b *Buffer) nowTime() time.Time {
	if b.now == nil {
		return time.Now()
	}
	return b.now()
}

// pruneLocked removes samples older than cutoff. Must be called with mu held.
func (b *Buffer) pruneLocked(cutoff time.Time) {
	i := 0
	for _, s := range b.samples {
		if s.recordedAt.After(cutoff) {
			b.samples[i] = s
			i++
		}
	}
	b.samples = b.samples[:i]
}

func (b *Buffer) Add(bpm int) error {
	if bpm <= 0 {
		return fmt.Errorf("invalid bpm: %d", bpm)
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	now := b.nowTime()
	b.pruneLocked(now.Add(-windowDuration))
	b.samples = append(b.samples, sample{bpm: bpm, recordedAt: now})
	return nil
}

// Average returns the average BPM of samples within the last 10 seconds.
// Returns (0, false) when no recent samples exist (stale).
func (b *Buffer) Average() (int, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.pruneLocked(b.nowTime().Add(-windowDuration))

	if len(b.samples) == 0 {
		return 0, false
	}

	sum := 0
	for _, s := range b.samples {
		sum += s.bpm
	}
	return sum / len(b.samples), true
}
