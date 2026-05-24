package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/kotaro/ddd/daemon/internal/hrm"
	"github.com/kotaro/ddd/daemon/internal/store"
	"github.com/labstack/echo/v4"
)

func newTestHandler(t *testing.T) *Handler {
	t.Helper()
	s, err := store.OpenAt(t.TempDir())
	if err != nil {
		t.Fatalf("store.OpenAt: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return NewHandler(hrm.NewBuffer(), s, nil, nil, nil)
}

// --- GetCurrent ---

func TestGetCurrent_Stale(t *testing.T) {
	h := newTestHandler(t)
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/heartrate/current", nil)
	rec := httptest.NewRecorder()

	if err := h.GetCurrent(e.NewContext(req, rec)); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp["status"] != "stale" {
		t.Fatalf("want status=stale, got %v", resp["status"])
	}
}

func TestGetCurrent_OK(t *testing.T) {
	h := newTestHandler(t)
	if err := h.buf.Add(130); err != nil {
		t.Fatal(err)
	}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/heartrate/current", nil)
	rec := httptest.NewRecorder()

	if err := h.GetCurrent(e.NewContext(req, rec)); err != nil {
		t.Fatal(err)
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp["status"] != "ok" {
		t.Fatalf("want status=ok, got %v", resp["status"])
	}
	if int(resp["bpm"].(float64)) != 130 {
		t.Fatalf("want bpm=130, got %v", resp["bpm"])
	}
}

// --- PostCommit ---

func postCommit(t *testing.T, h *Handler, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/commits", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	e := echo.New()
	if err := h.PostCommit(e.NewContext(req, rec)); err != nil {
		t.Fatal(err)
	}
	return rec
}

func TestPostCommit_Valid(t *testing.T) {
	rec := postCommit(t, newTestHandler(t), map[string]any{
		"repo_path": "/repo",
		"bpm":       150,
		"result":    "accepted",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPostCommit_MissingRepoPath(t *testing.T) {
	rec := postCommit(t, newTestHandler(t), map[string]any{
		"bpm":    150,
		"result": "accepted",
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}

func TestPostCommit_InvalidBPM(t *testing.T) {
	rec := postCommit(t, newTestHandler(t), map[string]any{
		"repo_path": "/repo",
		"bpm":       0,
		"result":    "accepted",
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}

func TestPostCommit_InvalidResult(t *testing.T) {
	rec := postCommit(t, newTestHandler(t), map[string]any{
		"repo_path": "/repo",
		"bpm":       150,
		"result":    "unknown",
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}

// --- WebSocket ---

func dialWS(t *testing.T, srv *httptest.Server) *websocket.Conn {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("ws dial: %v", err)
	}
	return conn
}

func TestWS_ReceivesValidBPM(t *testing.T) {
	buf := hrm.NewBuffer()
	s, err := store.OpenAt(t.TempDir())
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	defer s.Close()

	e := echo.New()
	e.GET("/ws", NewHandler(buf, s, nil, nil, nil).WS)
	srv := httptest.NewServer(e)
	defer srv.Close()

	conn := dialWS(t, srv)
	defer conn.Close()

	if err := conn.WriteJSON(map[string]any{
		"bpm":       150,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatalf("write: %v", err)
	}

	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		if _, ok := buf.Average(); ok {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}

	bpm, ok := buf.Average()
	if !ok {
		t.Fatal("buffer is stale after sending valid BPM")
	}
	if bpm != 150 {
		t.Fatalf("want bpm=150, got %d", bpm)
	}
}

func TestWS_InvalidJSON(t *testing.T) {
	buf := hrm.NewBuffer()
	s, err := store.OpenAt(t.TempDir())
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	defer s.Close()

	e := echo.New()
	e.GET("/ws", NewHandler(buf, s, nil, nil, nil).WS)
	srv := httptest.NewServer(e)
	defer srv.Close()

	conn := dialWS(t, srv)
	defer conn.Close()

	if err := conn.WriteMessage(websocket.TextMessage, []byte("not json")); err != nil {
		t.Fatalf("write: %v", err)
	}

	// 不正JSONはバッファに追加されないことを確認（500ms待っても stale のまま）
	time.Sleep(100 * time.Millisecond)

	_, ok := buf.Average()
	if ok {
		t.Fatal("buffer should be stale after invalid JSON")
	}
}
