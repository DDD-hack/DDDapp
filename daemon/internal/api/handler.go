package api

import (
	"encoding/json"
	"net/http"
	"net/url"
	"time"

	"github.com/gorilla/websocket"
	"github.com/kotaro/ddd/daemon/internal/hrm"
	"github.com/kotaro/ddd/daemon/internal/store"
	"github.com/labstack/echo/v4"
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
		return host == "localhost" || host == "127.0.0.1" || host == "::1"
	},
}

type Handler struct {
	buf *hrm.Buffer
	db  *store.Store
}

func NewHandler(buf *hrm.Buffer, db *store.Store) *Handler {
	return &Handler{buf: buf, db: db}
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
	return c.JSON(http.StatusCreated, map[string]string{"status": "ok"})
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
