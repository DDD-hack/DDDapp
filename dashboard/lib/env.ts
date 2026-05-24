/**
 * 実行環境の判定ユーティリティ。
 *
 * Vercel 等のクラウドにデプロイされたダッシュボードからローカル daemon
 * (ws://localhost:8765) に接続を試行すると、毎回 WebSocket failed や
 * CORS エラーが連発する。クラウド環境ではそもそも接続を試みず、
 * RTDB 経由のフォールバックに直行する判定にこのヘルパーを使う。
 */
export function isCloudEnvironment(): boolean {
  // SSR 中 (server-side rendering) は window が無いのでローカル扱いにする。
  // 実際の判定はブラウザでハイドレーション後に行われる。
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return !["localhost", "127.0.0.1", "::1"].includes(host);
}
