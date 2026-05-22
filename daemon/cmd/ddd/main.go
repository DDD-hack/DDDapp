package main

import (
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
	viper.SetDefault("DAEMON_PORT", "8765")
	viper.SetDefault("ALLOWED_ORIGINS", "")

	port := viper.GetString("DAEMON_PORT")

	db, err := store.Open()
	if err != nil {
		log.Fatalf("failed to open store: %v", err)
	}
	defer func() {
		if err := db.Close(); err != nil {
			log.Printf("failed to close store: %v", err)
		}
	}()

	buf := hrm.NewBuffer()
	h := api.NewHandler(buf, db)

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

	// Broadcast BPM to VS Code extensions every second
	go func() {
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			if bpm, ok := buf.Average(); ok {
				h.BroadcastVscode(map[string]any{
					"type": "bpm",
					"bpm":  bpm,
				})
			} else {
				h.BroadcastVscode(map[string]any{
					"type":   "bpm",
					"bpm":    0,
					"status": "stale",
				})
			}
		}
	}()

	log.Printf("DDD daemon starting on :%s", port)
	if err := e.Start(":" + port); err != nil && err != http.ErrServerClosed {
		log.Fatalf("failed to start server: %v", err)
	}
}
