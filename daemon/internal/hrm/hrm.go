package hrm

import (
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

func (b *Buffer) Add(bpm int) {
	if bpm <= 0 {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	now := b.now()
	b.pruneLocked(now.Add(-windowDuration))
	b.samples = append(b.samples, sample{bpm: bpm, recordedAt: now})
}

// Average returns the average BPM of samples within the last 10 seconds.
// Returns (0, false) when no recent samples exist (stale).
func (b *Buffer) Average() (int, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.pruneLocked(b.now().Add(-windowDuration))

	if len(b.samples) == 0 {
		return 0, false
	}

	sum := 0
	for _, s := range b.samples {
		sum += s.bpm
	}
	return sum / len(b.samples), true
}
