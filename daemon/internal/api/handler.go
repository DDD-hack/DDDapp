package api

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
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
	fs      *store.FirestoreClient // nil 可: Firestore 未設定時
	session *Session

	mu          sync.Mutex
	vscodeConns []*websocket.Conn
}

func NewHandler(buf *hrm.Buffer, db *store.Store, fs *store.FirestoreClient, session *Session) *Handler {
	if session == nil {
		session = NewSession()
	}
	return &Handler{
		buf:         buf,
		db:          db,
		fs:          fs,
		session:     session,
		vscodeConns: make([]*websocket.Conn, 0),
	}
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

		// Firestore へのバックグラウンド書き込み（uid 既知 & スロットル許容時のみ）
		h.maybeWriteBpmToFirestore(payload.BPM)
	}
	return nil
}

// maybeWriteBpmToFirestore は uid が設定済みかつスロットル間隔を満たすときだけ
// goroutine で Firestore に書き込む。ローカル機能をブロックしない。
func (h *Handler) maybeWriteBpmToFirestore(bpm int) {
	if h.fs == nil {
		return
	}
	uid, name, ok := h.session.Current()
	if !ok {
		return
	}
	if !h.session.MarkBpmWrite(time.Now()) {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := h.fs.UpsertUserBpm(ctx, uid, name, bpm); err != nil {
			// fail-open: ローカルは動き続けるので warn だけ
			log.Printf("firestore: upsert bpm: %v", err)
		}
	}()
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

	// Firestore へのバックグラウンド書き込み（uid 既知のときのみ、スロットルなし）
	if h.fs != nil {
		if uid, _, ok := h.session.Current(); ok {
			go func(uid, repoPath, hash, result string, bpm int) {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				if err := h.fs.AddUserCommit(ctx, uid, repoPath, hash, bpm, result); err != nil {
					log.Printf("firestore: add commit: %v", err)
				}
			}(uid, req.RepoPath, req.CommitHash, req.Result, req.BPM)
		}
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
			c.Logger().Infof("auth_sync received: uid=%s name=%q", env.UID, env.DisplayName)
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
