package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/kotaro/ddd/daemon/internal/discord"
	"github.com/kotaro/ddd/daemon/internal/hrm"
	"github.com/kotaro/ddd/daemon/internal/store"
	"github.com/labstack/echo/v4"
	"github.com/spf13/viper"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		// iPhone native app sends no Origin header — allow empty.
		if origin == "" {
			return true
		}
		u, err := url.Parse(origin)
		if err != nil {
			return false
		}
		host := u.Hostname()

		// Localhost and internal loopback origins are always allowed.
		if host == "localhost" || host == "127.0.0.1" || host == "::1" {
			return true
		}

		// Dynamically validate against ALLOWED_ORIGINS env variable
		allowedOriginsStr := viper.GetString("ALLOWED_ORIGINS")
		if allowedOriginsStr != "" {
			for _, allowed := range strings.Split(allowedOriginsStr, ",") {
				trimmed := strings.TrimSpace(allowed)
				if trimmed == "" {
					continue
				}
				parsedAllowed, err := url.Parse(trimmed)
				if err == nil {
					allowedHost := parsedAllowed.Hostname()
					if allowedHost == host {
						return true
					}
					// Support simple wildcard suffixes (e.g. *.vercel.app -> strings.HasSuffix)
					if strings.HasPrefix(allowedHost, "*.") {
						suffix := allowedHost[1:] // e.g. ".vercel.app"
						if strings.HasSuffix(host, suffix) {
							return true
						}
					}
				} else {
					// Fallback to exact match if parsing as URL fails
					if trimmed == host {
						return true
					}
				}
			}
		}

		return false
	},
}

type Handler struct {
	buf     *hrm.Buffer
	db      *store.Store
	fs      *store.FirestoreClient // nil 可: Firestore 未設定時（現状は未使用、将来用に残置）
	rtdb    *store.RTDBClient      // nil 可: RTDB 未設定時
	session *Session

	discordWebhookURL string // 空文字なら通知しない
	thresholdBPM      int    // コミット許可の閾値（デフォルト 120）

	mu          sync.Mutex
	vscodeConns []*websocket.Conn
}

func NewHandler(buf *hrm.Buffer, db *store.Store, fs *store.FirestoreClient, rtdb *store.RTDBClient, session *Session) *Handler {
	if session == nil {
		session = NewSession()
	}
	return &Handler{
		buf:          buf,
		db:           db,
		fs:           fs,
		rtdb:         rtdb,
		session:      session,
		thresholdBPM: 120,
		vscodeConns:  make([]*websocket.Conn, 0),
	}
}

// SetDiscordWebhookURL configures the Discord webhook URL for commit notifications.
// An empty string disables notifications.
func (h *Handler) SetDiscordWebhookURL(u string) { h.discordWebhookURL = u }

// SetThresholdBPM sets the BPM threshold used for notification labels.
// Must match DDD_THRESHOLD_BPM to keep labels consistent with commit acceptance.
// Falls back to 120 if t <= 0.
func (h *Handler) SetThresholdBPM(t int) {
	if t <= 0 {
		t = 120
	}
	h.thresholdBPM = t
}

// Session returns the active dashboard session (uid / displayName holder).
// 起動時の broadcast goroutine から参照したいので exported にしている。
func (h *Handler) Session() *Session {
	return h.session
}

// FirestoreClient returns the active Firestore client (may be nil).
func (h *Handler) FirestoreClient() *store.FirestoreClient {
	return h.fs
}

// RTDBClient returns the active Realtime Database client (may be nil).
func (h *Handler) RTDBClient() *store.RTDBClient {
	return h.rtdb
}

// WriteCurrentBpmToRTDB は 1Hz の broadcast ループから呼ばれる想定で、
// users/{uid}/current_bpm を RTDB に書き込む。uid 未設定や RTDB nil なら no-op。
// 呼び出し側を絶対にブロックしないため goroutine で投げる。
func (h *Handler) WriteCurrentBpmToRTDB(bpm int) {
	if h.rtdb == nil {
		return
	}
	uid, _, ok := h.session.Current()
	if !ok {
		return
	}
	go func(uid string, bpm int) {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := h.rtdb.SetCurrentBpm(ctx, uid, bpm); err != nil {
			// fail-open: ローカル機能は動き続けるので warn だけ
			log.Printf("rtdb: set current_bpm: %v", err)
		}
	}(uid, bpm)
}

// WS handles WebSocket connections from the iPhone app.
// iPhone sends: {"bpm": 152, "timestamp": "2025-05-19T10:00:00Z"}
func (h *Handler) WS(c echo.Context) error {
	conn, err := upgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		return err
	}
	defer conn.Close()

	ctx := c.Request().Context()

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var payload struct {
			BPM       int    `json:"bpm"`
			Timestamp string `json:"timestamp"`
		}
		if err := json.Unmarshal(message, &payload); err != nil {
			continue
		}
		// timestamp はフォーマット検証のみ。recordedAt にはサーバー受信時刻を使う
		// （iPhone との時計ズレで 10 秒ウィンドウがずれるのを防ぐため）
		if _, err := time.Parse(time.RFC3339, payload.Timestamp); err != nil {
			continue
		}
		if err := h.buf.Add(payload.BPM); err != nil {
			c.Logger().Warnf("ws: %v", err)
			continue
		}
		if err := h.db.SaveSample(ctx, payload.BPM, "apple_watch"); err != nil {
			c.Logger().Warnf("ws: save sample: %v", err)
		}

		// 注意: BPM の RTDB 書き込みはここでは行わない。
		// main.go の 1Hz broadcast ループが Buffer.Average() を取って
		// h.WriteCurrentBpmToRTDB() を呼ぶことで、Apple Watch の送信レートに
		// 依存せず常に 1Hz で /users/{uid}/current_bpm を更新する。
	}
	return nil
}

// PostCommit records a commit attempt (accepted or rejected) from the git hook.
func (h *Handler) PostCommit(c echo.Context) error {
	var req struct {
		RepoPath   string `json:"repo_path"`
		CommitHash string `json:"commit_hash"`
		BPM        int    `json:"bpm"`
		Result     string `json:"result"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}
	if req.RepoPath == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "repo_path is required"})
	}
	if req.BPM <= 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "bpm must be greater than 0"})
	}
	if req.Result != "accepted" && req.Result != "rejected" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "result must be accepted or rejected"})
	}
	if err := h.db.SaveCommitAttempt(c.Request().Context(), req.RepoPath, req.CommitHash, req.BPM, req.Result); err != nil {
		c.Logger().Warnf("post commit: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to save"})
	}

	h.BroadcastVscode(map[string]any{
		"type":   "commit_result",
		"result": req.Result,
		"bpm":    req.BPM,
	})

	uid, displayName, hasSession := h.session.Current()
	parent := c.Request().Context()

	// RTDB へのバックグラウンド書き込み（uid 既知のときのみ）。
	// /commits/{uid} 配下に push-id 付きでコミット結果を追記する。
	if h.rtdb != nil && hasSession {
		go func(parent context.Context, uid, repoPath, hash, result string, bpm int) {
			ctx, cancel := context.WithTimeout(parent, 5*time.Second)
			defer cancel()
			if err := h.rtdb.AddCommit(ctx, uid, repoPath, hash, bpm, result); err != nil {
				log.Printf("rtdb: add commit: %v", err)
			}
		}(parent, uid, req.RepoPath, req.CommitHash, req.Result, req.BPM)
	}

	// Discord 通知（webhook 未設定なら no-op）。
	if h.discordWebhookURL != "" {
		threshold := h.thresholdBPM
		go func() {
			ctx, cancel := context.WithTimeout(parent, 5*time.Second)
			defer cancel()
			if err := discord.Send(ctx, h.discordWebhookURL, commitPayload(displayName, req.RepoPath, req.CommitHash, req.Result, req.BPM, threshold)); err != nil {
				log.Printf("discord: %v", err)
			}
		}()
	}

	return c.JSON(http.StatusCreated, map[string]string{"status": "ok"})
}

// VscodeWS handles WebSocket connections from the dashboard / VS Code extension.
//
// 受信メッセージ:
//
//	{"type":"auth_sync","uid":"<firebase-uid>","displayName":"<name>"}
//	  -> 現在アクティブな uid を session に記録する。空 uid は Clear と等価。
//
// それ以外のメッセージは無視する。
func (h *Handler) VscodeWS(c echo.Context) error {
	conn, err := upgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		return err
	}

	h.mu.Lock()
	h.vscodeConns = append(h.vscodeConns, conn)
	h.mu.Unlock()

	defer func() {
		h.mu.Lock()
		for i, c := range h.vscodeConns {
			if c == conn {
				h.vscodeConns = append(h.vscodeConns[:i], h.vscodeConns[i+1:]...)
				break
			}
		}
		h.mu.Unlock()
		conn.Close()
	}()

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			break
		}
		h.handleVscodeMessage(c, message)
	}
	return nil
}

// handleVscodeMessage は dashboard / VS Code 拡張からの JSON メッセージを処理する。
// 解析エラーや未知の type は単にスキップ（fail-open）。
func (h *Handler) handleVscodeMessage(c echo.Context, message []byte) {
	var env struct {
		Type        string `json:"type"`
		UID         string `json:"uid"`
		DisplayName string `json:"displayName"`
	}
	if err := json.Unmarshal(message, &env); err != nil {
		return
	}
	switch env.Type {
	case "auth_sync":
		h.session.SetAuth(env.UID, env.DisplayName)
		if env.UID != "" {
			mask := func(s string) string {
				if len(s) <= 6 {
					return "***"
				}
				return s[:3] + "..." + s[len(s)-3:]
			}
			c.Logger().Infof("auth_sync received: uid=%s name=%q", mask(env.UID), mask(env.DisplayName))
		} else {
			c.Logger().Infof("auth_sync cleared")
		}
	}
}

// BroadcastVscode sends a JSON message to all connected VS Code extensions.
func (h *Handler) BroadcastVscode(msg any) {
	h.mu.Lock()
	conns := make([]*websocket.Conn, len(h.vscodeConns))
	copy(conns, h.vscodeConns)
	h.mu.Unlock()

	for _, conn := range conns {
		if err := conn.WriteJSON(msg); err != nil {
			// Errors will be cleaned up on next read failure
			continue
		}
	}
}

// GetCommits returns recent commit attempts from the database.
// Query param: limit (default 50, max 200)
func (h *Handler) GetCommits(c echo.Context) error {
	limit := 50
	if v := c.QueryParam("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			return echo.NewHTTPError(http.StatusBadRequest, "limit must be a positive integer")
		}
		if n > 200 {
			n = 200
		}
		limit = n
	}
	rows, err := h.db.GetCommitAttempts(c.Request().Context(), limit)
	if err != nil {
		c.Logger().Warnf("get commits: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to query"})
	}
	if rows == nil {
		rows = []store.CommitAttempt{}
	}
	return c.JSON(http.StatusOK, rows)
}

// GetHeartRateHistory returns recent heart rate samples from the database.
// Query param: limit (default 200, max 1000)
func (h *Handler) GetHeartRateHistory(c echo.Context) error {
	limit := 200
	if v := c.QueryParam("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			return echo.NewHTTPError(http.StatusBadRequest, "limit must be a positive integer")
		}
		if n > 1000 {
			n = 1000
		}
		limit = n
	}
	rows, err := h.db.GetHeartRateSamples(c.Request().Context(), limit)
	if err != nil {
		c.Logger().Warnf("get heartrate history: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to query"})
	}
	if rows == nil {
		rows = []store.HeartRateSample{}
	}
	return c.JSON(http.StatusOK, rows)
}

// commitPayload builds a Discord embed for a commit result.
func commitPayload(displayName, repoPath, commitHash, result string, bpm, threshold int) discord.Payload {
	color := 0x2ECC71 // green
	title := "✅ COMMIT ACCEPTED"
	if result != "accepted" {
		color = 0xE74C3C // red
		title = "💀 COMMIT REJECTED"
	}

	name := displayName
	if name == "" {
		name = "unknown"
	}
	repo := filepath.Base(repoPath)
	hash := commitHash
	if len(hash) > 7 {
		hash = hash[:7]
	}
	if hash == "" {
		hash = "—"
	}

	bpmLabel := fmt.Sprintf("%d bpm", bpm)
	switch {
	case bpm > 150:
		bpmLabel += " 🔥"
	case bpm >= threshold:
		bpmLabel += " 💪"
	default:
		bpmLabel += " 😰"
	}

	return discord.Payload{
		Embeds: []discord.Embed{{
			Title: title,
			Color: color,
			Fields: []discord.Field{
				{Name: "Developer", Value: name, Inline: true},
				{Name: "BPM", Value: bpmLabel, Inline: true},
				{Name: "Repo", Value: repo, Inline: true},
				{Name: "Hash", Value: "`" + hash + "`", Inline: true},
			},
			Footer: &discord.Footer{Text: "DOKI DOKI DEVELOPMENT"},
		}},
	}
}

// GetCurrent returns the current average BPM for the git hook.
func (h *Handler) GetCurrent(c echo.Context) error {
	bpm, ok := h.buf.Average()
	if !ok {
		return c.JSON(http.StatusOK, map[string]any{
			"bpm":    0,
			"status": "stale",
		})
	}
	return c.JSON(http.StatusOK, map[string]any{
		"bpm":    bpm,
		"status": "ok",
	})
}
