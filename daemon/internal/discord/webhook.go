package discord

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type Embed struct {
	Title  string  `json:"title"`
	URL    string  `json:"url,omitempty"`
	Color  int     `json:"color"`
	Fields []Field `json:"fields,omitempty"`
	Footer *Footer `json:"footer,omitempty"`
}

type Field struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline,omitempty"`
}

type Footer struct {
	Text string `json:"text"`
}

type Payload struct {
	Embeds []Embed `json:"embeds"`
}

// Send POSTs payload to webhookURL. Returns nil immediately if webhookURL is empty.
// Discord への送信に失敗してもコミットは妨げない（fail-safe）。
// タイムアウトは 5 秒固定。
func Send(ctx context.Context, webhookURL string, p Payload) error {
	if webhookURL == "" {
		return nil
	}
	body, err := json.Marshal(p)
	if err != nil {
		return fmt.Errorf("discord: marshal: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, webhookURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("discord: new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	c := &http.Client{Timeout: 5 * time.Second}
	resp, err := c.Do(req)
	if err != nil {
		return fmt.Errorf("discord: do: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("discord: status %d", resp.StatusCode)
	}
	return nil
}
// BPM: 135 on 2026年 5月24日 日曜日 11時54分31秒 JST
