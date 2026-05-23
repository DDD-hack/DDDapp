package api

import (
	"sync"
	"time"
)

// BpmWriteInterval は同一 uid に対する Firestore BPM 書き込みの最小間隔。
// Apple Watch から 1Hz 程度で BPM が届くので、そのまま書くと Firestore の
// 無料枠（50k writes/day）をすぐ食いつぶす。2 秒間隔なら 1 日 ~43k で収まる試算。
const BpmWriteInterval = 2 * time.Second

// Session はダッシュボードから auth_sync で受け取った現在のユーザー情報と、
// Firestore への BPM 書き込みのスロットリング状態を保持する。
//
// ハッカソン用途では同時に 1 ユーザーしか想定しないため、単一スロットで管理する。
// 複数ブラウザから別ユーザーがログインした場合は「最後勝ち」になる仕様。
type Session struct {
	mu          sync.RWMutex
	uid         string
	displayName string
	lastBpmAt   time.Time
}

// NewSession returns an empty Session ready to be used.
func NewSession() *Session {
	return &Session{}
}

// SetAuth は現在アクティブなユーザーを記録する。空文字 uid は Clear と等価。
func (s *Session) SetAuth(uid, displayName string) {
	if uid == "" {
		s.Clear()
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.uid != uid {
		// 別ユーザーへの切替なら BPM スロットリングもリセットして即書き込めるようにする
		s.lastBpmAt = time.Time{}
	}
	s.uid = uid
	s.displayName = displayName
}

// Clear はアクティブユーザーを消す（ログアウト時に呼ぶ）。
func (s *Session) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.uid = ""
	s.displayName = ""
	s.lastBpmAt = time.Time{}
}

// Current は現在の uid / displayName と、uid が設定済みかを返す。
func (s *Session) Current() (uid string, displayName string, ok bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.uid, s.displayName, s.uid != ""
}

// MarkBpmWrite は前回書き込みから BpmWriteInterval 以上経過していれば
// true を返し、内部の lastBpmAt を now に更新する。
// チェックと更新がアトミックなので、呼び出し側に追加のロックは不要。
func (s *Session) MarkBpmWrite(now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.uid == "" {
		return false
	}
	if now.Sub(s.lastBpmAt) < BpmWriteInterval {
		return false
	}
	s.lastBpmAt = now
	return true
}
