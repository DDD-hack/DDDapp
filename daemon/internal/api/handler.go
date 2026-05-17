package api

import (
	"encoding/json"
	"net/http"
	"strings"
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
		// Browser-based callers must come from localhost.
		return origin == "" || strings.HasPrefix(origin, "http://localhost")
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
		if err := h.db.SaveSample(payload.BPM, "apple_watch"); err != nil {
			c.Logger().Warnf("ws: save sample: %v", err)
		}
	}
	return nil
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
