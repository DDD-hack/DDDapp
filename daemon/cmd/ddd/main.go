package main

import (
	"log"
	"net/http"

	"github.com/kotaro/ddd/daemon/internal/api"
	"github.com/kotaro/ddd/daemon/internal/hrm"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/spf13/viper"
)

func main() {
	viper.SetEnvPrefix("DDD")
	viper.AutomaticEnv()
	viper.SetDefault("DAEMON_PORT", "8765")

	port := viper.GetString("DAEMON_PORT")

	buf := hrm.NewBuffer()
	h := api.NewHandler(buf)

	e := echo.New()
	e.Use(middleware.Logger())
	e.Use(middleware.Recover())

	e.GET("/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})
	e.GET("/ws", h.WS)
	e.GET("/heartrate/current", h.GetCurrent)

	log.Printf("DDD daemon starting on :%s", port)
	if err := e.Start(":" + port); err != nil && err != http.ErrServerClosed {
		log.Fatalf("failed to start server: %v", err)
	}
}
