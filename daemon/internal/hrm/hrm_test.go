package hrm

import (
	"sync"
	"testing"
	"time"
)

// fixedClock returns a function that always returns t.
func fixedClock(t time.Time) func() time.Time {
	return func() time.Time { return t }
}

func TestAverage_EmptyBuffer(t *testing.T) {
	buf := NewBuffer()
	bpm, ok := buf.Average()
	if ok {
		t.Fatalf("empty buffer: want ok=false, got ok=true")
	}
	if bpm != 0 {
		t.Fatalf("empty buffer: want bpm=0, got bpm=%d", bpm)
	}
}

func TestAverage_CorrectMean(t *testing.T) {
	buf := NewBuffer()
	if err := buf.Add(100); err != nil {
		t.Fatal(err)
	}
	if err := buf.Add(200); err != nil {
		t.Fatal(err)
	}
	bpm, ok := buf.Average()
	if !ok {
		t.Fatal("want ok=true, got ok=false")
	}
	if bpm != 150 {
		t.Fatalf("want bpm=150, got bpm=%d", bpm)
	}
}

func TestAverage_SingleSample(t *testing.T) {
	buf := NewBuffer()
	if err := buf.Add(120); err != nil {
		t.Fatal(err)
	}
	bpm, ok := buf.Average()
	if !ok {
		t.Fatal("want ok=true, got ok=false")
	}
	if bpm != 120 {
		t.Fatalf("want bpm=120, got bpm=%d", bpm)
	}
}

func TestAdd_InvalidBPM(t *testing.T) {
	buf := NewBuffer()
	for _, bpm := range []int{0, -1, -100} {
		if err := buf.Add(bpm); err == nil {
			t.Fatalf("bpm=%d: want error, got nil", bpm)
		}
	}
	// 不正値が追加されていないことを確認
	_, ok := buf.Average()
	if ok {
		t.Fatal("不正な bpm が追加されている: want ok=false, got ok=true")
	}
}

func TestAdd_StaleAfterWindow(t *testing.T) {
	base := time.Now()
	buf := &Buffer{now: fixedClock(base)}

	if err := buf.Add(150); err != nil {
		t.Fatal(err)
	}

	// 時計を11秒後に進める
	buf.now = fixedClock(base.Add(11 * time.Second))

	bpm, ok := buf.Average()
	if ok {
		t.Fatalf("11秒後は stale のはず: want ok=false, got ok=true (bpm=%d)", bpm)
	}
}

func TestAdd_WithinWindow(t *testing.T) {
	base := time.Now()
	buf := &Buffer{now: fixedClock(base)}

	if err := buf.Add(130); err != nil {
		t.Fatal(err)
	}

	// 9秒後はまだウィンドウ内
	buf.now = fixedClock(base.Add(9 * time.Second))

	_, ok := buf.Average()
	if !ok {
		t.Fatal("9秒後はまだウィンドウ内のはず: want ok=true, got ok=false")
	}
}

func TestAdd_PrunesOldSamplesOnWrite(t *testing.T) {
	base := time.Now()
	buf := &Buffer{now: fixedClock(base)}

	if err := buf.Add(100); err != nil {
		t.Fatal(err)
	}

	// 11秒後に新しいサンプルを追加 → 古いサンプルは Add 時に削除される
	buf.now = fixedClock(base.Add(11 * time.Second))
	if err := buf.Add(200); err != nil {
		t.Fatal(err)
	}

	bpm, ok := buf.Average()
	if !ok {
		t.Fatal("want ok=true, got ok=false")
	}
	if bpm != 200 {
		t.Fatalf("古いサンプルが残っている: want bpm=200, got bpm=%d", bpm)
	}
}

func TestAdd_ZeroValueBuffer(t *testing.T) {
	// NewBuffer() を使わずゼロ値でも panic しないことを確認
	var buf Buffer
	if err := buf.Add(100); err != nil {
		t.Fatal(err)
	}
	_, ok := buf.Average()
	if !ok {
		t.Fatal("want ok=true, got ok=false")
	}
}

func TestConcurrent_NoRaceCondition(t *testing.T) {
	buf := NewBuffer()
	var wg sync.WaitGroup

	// Add と Average を交互に起動して真の並行アクセスを発生させる
	for i := 0; i < 50; i++ {
		wg.Add(2)
		go func(bpm int) {
			defer wg.Done()
			_ = buf.Add(bpm)
		}(i + 1)
		go func() {
			defer wg.Done()
			buf.Average()
		}()
	}

	wg.Wait()
}
