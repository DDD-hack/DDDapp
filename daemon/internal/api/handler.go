package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
	"github.com/kotaro/ddd/daemon/internal/hrm"
	"github.com/labstack/echo/v4"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		return origin == "" || strings.HasPrefix(origin, "http://localhost")
	},
}

type Handler struct {
	buf *hrm.Buffer
}

func NewHandler(buf *hrm.Buffer) *Handler {
	return &Handler{buf: buf}
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
			BPM int `json:"bpm"`
		}
		if err := json.Unmarshal(message, &payload); err != nil {
			continue
		}
		if payload.BPM > 0 {
			h.buf.Add(payload.BPM)
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
