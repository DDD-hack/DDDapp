package api

import (
	"sync"
	"testing"
	"time"
)

func TestSession_SetAuth_AndCurrent(t *testing.T) {
	t.Parallel()
	s := NewSession()
	if _, _, ok := s.Current(); ok {
		t.Fatal("fresh session should report no uid")
	}

	s.SetAuth("uid-1", "Taro")
	uid, name, ok := s.Current()
	if !ok || uid != "uid-1" || name != "Taro" {
		t.Fatalf("got (%q,%q,%v), want (uid-1, Taro, true)", uid, name, ok)
	}

	// 空 uid は Clear と等価
	s.SetAuth("", "Taro")
	if _, _, ok := s.Current(); ok {
		t.Fatal("SetAuth('') should clear the session")
	}
}

func TestSession_Clear(t *testing.T) {
	t.Parallel()
	s := NewSession()
	s.SetAuth("uid-1", "Taro")
	s.Clear()
	if _, _, ok := s.Current(); ok {
		t.Fatal("Clear should remove uid")
	}
}

func TestSession_MarkBpmWrite_Throttle(t *testing.T) {
	t.Parallel()
	s := NewSession()
	s.SetAuth("uid-1", "Taro")
	t0 := time.Now()

	if !s.MarkBpmWrite(t0) {
		t.Fatal("first write should be allowed")
	}
	if s.MarkBpmWrite(t0.Add(BpmWriteInterval - 100*time.Millisecond)) {
		t.Fatal("write within throttle interval should be denied")
	}
	if !s.MarkBpmWrite(t0.Add(BpmWriteInterval + time.Millisecond)) {
		t.Fatal("write after throttle interval should be allowed")
	}
}

func TestSession_MarkBpmWrite_RequiresUID(t *testing.T) {
	t.Parallel()
	s := NewSession()
	if s.MarkBpmWrite(time.Now()) {
		t.Fatal("MarkBpmWrite without uid should return false")
	}
}

func TestSession_MarkBpmWrite_ResetsOnUserSwitch(t *testing.T) {
	t.Parallel()
	s := NewSession()
	t0 := time.Now()

	s.SetAuth("uid-1", "Taro")
	if !s.MarkBpmWrite(t0) {
		t.Fatal("first write should be allowed")
	}
	// 同一ユーザーなら直後の書き込みは denied
	if s.MarkBpmWrite(t0.Add(10 * time.Millisecond)) {
		t.Fatal("second write within interval should be denied")
	}
	// 別ユーザーに切り替えたら lastBpmAt がリセットされ即書き込み可
	s.SetAuth("uid-2", "Hanako")
	if !s.MarkBpmWrite(t0.Add(10 * time.Millisecond)) {
		t.Fatal("write after user switch should be allowed immediately")
	}
}

// データレース検出用: 並行な SetAuth / Current / MarkBpmWrite を多数走らせる。
// go test -race で問題が無いことを確認する。
func TestSession_ConcurrentAccess(t *testing.T) {
	t.Parallel()
	s := NewSession()
	var wg sync.WaitGroup
	const goroutines = 8
	const iterations = 500

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for j := 0; j < iterations; j++ {
				switch j % 3 {
				case 0:
					s.SetAuth("uid", "name")
				case 1:
					_, _, _ = s.Current()
				case 2:
					_ = s.MarkBpmWrite(time.Now())
				}
			}
		}(i)
	}
	wg.Wait()
}
