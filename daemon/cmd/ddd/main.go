package main

import (
	"context"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/kotaro/ddd/daemon/internal/api"
	"github.com/kotaro/ddd/daemon/internal/hrm"
	"github.com/kotaro/ddd/daemon/internal/store"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/spf13/viper"
)

func main() {
	viper.SetEnvPrefix("DDD")
	viper.AutomaticEnv()
	viper.SetDefault("DDD_DAEMON_PORT", "8765")
	viper.SetDefault("ALLOWED_ORIGINS", "")
	viper.SetDefault("FIREBASE_CREDENTIALS", "")
	viper.SetDefault("FIREBASE_PROJECT_ID", "")
	viper.SetDefault("FIREBASE_DATABASE_URL", "")
	viper.SetDefault("DDD_THRESHOLD_BPM", 120)
	viper.SetDefault("DISCORD_WEBHOOK_URL", "")

	port := viper.GetString("DDD_DAEMON_PORT")

	db, err := store.Open()
	if err != nil {
		log.Fatalf("failed to open store: %v", err)
	}
	defer func() {
		if err := db.Close(); err != nil {
			log.Printf("failed to close store: %v", err)
		}
	}()

	// Firestore は fail-safe: credentials 未設定なら nil で動作（ローカルのみ）。
	fs, err := store.OpenFirestore(context.Background(),
		viper.GetString("FIREBASE_CREDENTIALS"),
		viper.GetString("FIREBASE_PROJECT_ID"),
	)
	if err != nil {
		log.Printf("firestore disabled: %v", err)
	}
	if fs == nil {
		log.Print("firestore: disabled (no credentials configured)")
	} else {
		log.Print("firestore: ready")
	}
	defer func() {
		if err := fs.Close(); err != nil {
			log.Printf("firestore close: %v", err)
		}
	}()

	// Realtime Database: BPM (1Hz) と commits の中継先。fail-safe で起動継続。
	rtdb, err := store.OpenRTDB(context.Background(),
		viper.GetString("FIREBASE_CREDENTIALS"),
		viper.GetString("FIREBASE_DATABASE_URL"),
	)
	if err != nil {
		log.Printf("rtdb disabled: %v", err)
	}
	if rtdb == nil {
		log.Print("rtdb: disabled (no credentials or database URL configured)")
	} else {
		log.Print("rtdb: ready")
	}

	buf := hrm.NewBuffer()
	h := api.NewHandler(buf, db, fs, rtdb, api.NewSession())
	h.SetDiscordWebhookURL(viper.GetString("DISCORD_WEBHOOK_URL"))

	e := echo.New()
	e.Use(middleware.Logger())
	e.Use(middleware.Recover())

	allowedOriginsStr := viper.GetString("ALLOWED_ORIGINS")
	var allowedOrigins []string
	if allowedOriginsStr != "" {
		for _, origin := range strings.Split(allowedOriginsStr, ",") {
			trimmed := strings.TrimSpace(origin)
			if trimmed != "" {
				allowedOrigins = append(allowedOrigins, trimmed)
			}
		}
	}
	if len(allowedOrigins) == 0 {
		allowedOrigins = []string{"http://localhost:3000"}
	}

	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: allowedOrigins,
		AllowMethods: []string{http.MethodGet, http.MethodPost},
		AllowHeaders: []string{echo.HeaderOrigin, echo.HeaderContentType, echo.HeaderAccept},
	}))

	e.GET("/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})
	e.GET("/ws", h.WS)
	e.GET("/ws/vscode", h.VscodeWS)
	e.GET("/heartrate/current", h.GetCurrent)
	e.GET("/heartrate/history", h.GetHeartRateHistory)
	e.GET("/commits", h.GetCommits)
	e.POST("/commits", h.PostCommit)

	// 1Hz broadcast loop:
	//   - VS Code 拡張 / ダッシュボード WebSocket への bpm メッセージ送信
	//   - Realtime Database への /users/{uid}/current_bpm 更新
	// どちらも非ブロッキング（BroadcastVscode は内部で並列送信、
	// WriteCurrentBpmToRTDB は内部で goroutine）。
	go func() {
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			if bpm, ok := buf.Average(); ok {
				h.BroadcastVscode(map[string]any{
					"type": "bpm",
					"bpm":  bpm,
				})
				h.WriteCurrentBpmToRTDB(bpm)
			} else {
				h.BroadcastVscode(map[string]any{
					"type":   "bpm",
					"bpm":    0,
					"status": "stale",
				})
				// stale 中も最後の値を保ちつつ、ダッシュボードに「鮮度切れ」を伝えたい
				// 場合は将来 SetCurrentBpmStale(uid) を追加することを検討する。
			}
		}
	}()

	log.Printf("DDD daemon starting on :%s", port)
	if err := e.Start(":" + port); err != nil && err != http.ErrServerClosed {
		log.Fatalf("failed to start server: %v", err)
	}
}
