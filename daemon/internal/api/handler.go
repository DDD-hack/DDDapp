package api

import (
	"encoding/json"
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
	buf *hrm.Buffer
	db  *store.Store

	mu          sync.Mutex
	vscodeConns []*websocket.Conn
}

func NewHandler(buf *hrm.Buffer, db *store.Store) *Handler {
	return &Handler{
		buf:         buf,
		db:          db,
		vscodeConns: make([]*websocket.Conn, 0),
	}
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

	h.BroadcastVscode(map[string]any{
		"type":   "commit_result",
		"result": req.Result,
		"bpm":    req.BPM,
	})

	return c.JSON(http.StatusCreated, map[string]string{"status": "ok"})
}

// VscodeWS handles WebSocket connections from the VS Code extension.
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
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}
	return nil
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
