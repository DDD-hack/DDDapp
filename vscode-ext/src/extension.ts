import * as vscode from "vscode";
import WebSocket from "ws";
import { exec } from "child_process";

let ws: WebSocket | null = null;
let statusBar: vscode.StatusBarItem;
let reconnectTimeout: NodeJS.Timeout | null = null;

// デモモード: 環境変数で閾値を変更可能（デフォルト120）
const THRESHOLD = Number(process.env.DDD_THRESHOLD) || 120;

// ──────────────────────────────────────────────
// WebSocket 接続
// ──────────────────────────────────────────────
const port = process.env.DDD_DAEMON_PORT || "8765";

function connectWebSocket() {
  if (ws) {
    ws.close();
  }

  ws = new WebSocket(`ws://localhost:${port}/ws/vscode`);

  ws.on("open", () => {
    console.log("DDD: Connected to daemon");
    statusBar.tooltip = "DDD: Connected";
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === "bpm") {
        handleBpmUpdate(msg);
      } else if (msg.type === "commit_result") {
        handleCommitResult(msg);
      }
    } catch (e) {
      console.error("DDD: Error parsing message", e);
    }
  });

  ws.on("close", () => {
    console.log("DDD: Disconnected from daemon");
    statusBar.text = `$(heart) disconnected`;
    statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    statusBar.tooltip = "DDD: Disconnected. Retrying in 5s...";

    // 自動再接続（5秒間隔）
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
    }
    reconnectTimeout = setTimeout(connectWebSocket, 5000);
  });

  ws.on("error", (err) => {
    console.error("DDD: WebSocket error", err);
    ws?.close();
  });
}

// ──────────────────────────────────────────────
// ステータスバー更新（心拍数リアルタイム表示）
// ──────────────────────────────────────────────
function handleBpmUpdate(msg: { bpm: number; status?: string }) {
  const bpm = msg.bpm;
  if (msg.status === "stale" || bpm === 0) {
    statusBar.text = `$(heart) -- bpm`;
    statusBar.backgroundColor = undefined;
    statusBar.tooltip = "DDD: Stale data";
  } else {
    statusBar.text = `$(heart) ${bpm} bpm`;
    statusBar.tooltip = `DDD: ${bpm} bpm (閾値: ${THRESHOLD})`;

    if (bpm > THRESHOLD) {
      // 情熱モード（赤背景）
      statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    } else {
      // 通常モード
      statusBar.backgroundColor = undefined;
    }
  }
}

// ──────────────────────────────────────────────
// コミット結果表示（WebViewパネル）
// ──────────────────────────────────────────────
function handleCommitResult(msg: { result: string; bpm: number }) {
  if (msg.result === "rejected") {
    playSystemSound("rejected");
    showRejectionPanel(msg.bpm);
  } else if (msg.result === "accepted") {
    playSystemSound("accepted");
    showAcceptedPanel(msg.bpm);
  }
}

/** OSの機能を使って自動で音を鳴らす（ブラウザブロック回避） */
function playSystemSound(type: "accepted" | "rejected") {
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";

  if (type === "accepted") {
    if (isWin) {
      exec(`powershell -c "(New-Object Media.SoundPlayer 'C:\\Windows\\Media\\tada.wav').PlaySync()"`);
    } else if (isMac) {
      exec(`afplay /System/Library/Sounds/Hero.aiff`);
    }
  } else {
    if (isWin) {
      exec(`powershell -c "(New-Object Media.SoundPlayer 'C:\\Windows\\Media\\chord.wav').PlaySync()"`);
    } else if (isMac) {
      exec(`afplay /System/Library/Sounds/Basso.aiff`);
    }
  }
}

/** 🔥 コミット成功パネル */
function showAcceptedPanel(bpm: number) {
  const panel = vscode.window.createWebviewPanel(
    "dddCommitAccepted",
    "🔥 PASSION COMMIT ACCEPTED 🔥",
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  panel.webview.html = getAcceptedHtml(bpm);

  // 8秒後に自動クローズ
  setTimeout(() => {
    if (panel.visible) {
      panel.dispose();
    }
  }, 8000);
}

/** ❌ コミット拒否パネル */
function showRejectionPanel(bpm: number) {
  const panel = vscode.window.createWebviewPanel(
    "dddCommitRejected",
    "❌ COMMIT REJECTED",
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  panel.webview.html = getRejectedHtml(bpm);
}

// ──────────────────────────────────────────────
// 成功時のHTML（火炎エフェクト + 効果音）
// ──────────────────────────────────────────────
function getAcceptedHtml(bpm: number): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    width: 100vw; height: 100vh;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    background: #0a0a0a;
    overflow: hidden;
    font-family: 'Segoe UI', 'Yu Gothic UI', sans-serif;
  }

  /* 背景グラデーション（脈動） */
  .bg {
    position: fixed; inset: 0;
    background: radial-gradient(ellipse at center,
      rgba(255, 60, 0, 0.3) 0%,
      rgba(180, 20, 0, 0.15) 40%,
      rgba(10, 10, 10, 1) 70%);
    animation: pulse-bg 1.5s ease-in-out infinite alternate;
  }
  @keyframes pulse-bg {
    0% { opacity: 0.6; }
    100% { opacity: 1; }
  }

  .content {
    position: relative; z-index: 2;
    text-align: center;
  }

  .fire-emoji {
    font-size: 80px;
    animation: bounce 0.6s ease-in-out infinite alternate;
  }
  @keyframes bounce {
    0% { transform: translateY(0) scale(1); }
    100% { transform: translateY(-15px) scale(1.1); }
  }

  .title {
    font-size: 52px; font-weight: 900;
    color: #fff;
    text-shadow:
      0 0 20px #ff4500,
      0 0 40px #ff6a00,
      0 0 80px #ff4500,
      0 0 120px #ff0000;
    animation: glow 1.2s ease-in-out infinite alternate;
    margin: 20px 0;
    letter-spacing: 4px;
  }
  @keyframes glow {
    0% { text-shadow: 0 0 20px #ff4500, 0 0 40px #ff6a00, 0 0 80px #ff4500; }
    100% { text-shadow: 0 0 30px #ffaa00, 0 0 60px #ff6a00, 0 0 100px #ff4500, 0 0 140px #ff0000; }
  }

  .subtitle {
    font-size: 28px; color: #ff9944;
    font-weight: 600;
    margin-top: 10px;
    opacity: 0;
    animation: fade-in 0.8s 0.5s forwards;
  }
  @keyframes fade-in {
    to { opacity: 1; }
  }

  .bpm-display {
    margin-top: 30px;
    font-size: 72px; font-weight: 900;
    color: #ff3300;
    text-shadow: 0 0 30px rgba(255, 51, 0, 0.6);
    animation: heartbeat 0.8s ease-in-out infinite;
  }
  @keyframes heartbeat {
    0%, 100% { transform: scale(1); }
    15% { transform: scale(1.15); }
    30% { transform: scale(1); }
    45% { transform: scale(1.1); }
  }

  .bpm-label {
    font-size: 20px; color: #aaa;
    margin-top: 5px;
    letter-spacing: 6px;
  }

  .message {
    margin-top: 30px;
    font-size: 18px; color: #888;
    opacity: 0;
    animation: fade-in 0.8s 1s forwards;
  }

  /* 火の粉パーティクル */
  .particle {
    position: fixed; bottom: -20px;
    font-size: 30px;
    animation: rise linear infinite;
    opacity: 0.8;
  }
  @keyframes rise {
    0% { transform: translateY(0) rotate(0deg); opacity: 0.9; }
    100% { transform: translateY(-110vh) rotate(720deg); opacity: 0; }
  }
</style>
</head>
<body>
  <div class="bg"></div>

  <div class="content">
    <div class="fire-emoji">🔥🔥🔥</div>
    <div class="title">PASSION COMMIT<br>ACCEPTED</div>
    <div class="subtitle">— 情熱が認められました —</div>
    <div class="bpm-display">♥ ${bpm}</div>
    <div class="bpm-label">B P M</div>
    <div class="message">このコミットは情熱によって承認されました。</div>
  </div>

  <script>
    // 火の粉パーティクル生成
    const emojis = ['🔥', '✨', '💛', '🧡', '❤️‍🔥'];
    for (let i = 0; i < 25; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      p.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      p.style.left = Math.random() * 100 + 'vw';
      p.style.animationDuration = (2 + Math.random() * 4) + 's';
      p.style.animationDelay = Math.random() * 3 + 's';
      p.style.fontSize = (20 + Math.random() * 25) + 'px';
      document.body.appendChild(p);
    }

  </script>
</body>
</html>`;
}

// ──────────────────────────────────────────────
// 拒否時のHTML（詳細情報 + サジェスト）
// ──────────────────────────────────────────────
function getRejectedHtml(bpm: number): string {
  const deficit = THRESHOLD - bpm;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    width: 100vw; height: 100vh;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    background: #0a0a0a;
    overflow: hidden;
    font-family: 'Segoe UI', 'Yu Gothic UI', sans-serif;
  }

  .bg {
    position: fixed; inset: 0;
    background: radial-gradient(ellipse at center,
      rgba(180, 0, 0, 0.2) 0%,
      rgba(60, 0, 0, 0.1) 40%,
      rgba(10, 10, 10, 1) 70%);
    animation: throb 2s ease-in-out infinite alternate;
  }
  @keyframes throb {
    0% { opacity: 0.5; }
    100% { opacity: 1; }
  }

  .content {
    position: relative; z-index: 2;
    text-align: center;
    max-width: 700px;
  }

  .icon {
    font-size: 80px;
    animation: shake 0.5s ease-in-out infinite;
  }
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-8px) rotate(-3deg); }
    75% { transform: translateX(8px) rotate(3deg); }
  }

  .title {
    font-size: 48px; font-weight: 900;
    color: #ff2222;
    text-shadow: 0 0 20px rgba(255, 0, 0, 0.5);
    margin: 15px 0;
    letter-spacing: 3px;
  }

  .reason {
    font-size: 22px; color: #cc6666;
    margin: 10px 0 30px;
  }

  .stats {
    display: flex; justify-content: center; gap: 50px;
    margin: 20px 0;
  }
  .stat-box {
    text-align: center;
    padding: 20px 30px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  .stat-value {
    font-size: 48px; font-weight: 900;
  }
  .stat-value.current { color: #6688cc; }
  .stat-value.threshold { color: #ff4444; }
  .stat-value.deficit { color: #ffaa00; }
  .stat-label {
    font-size: 13px; color: #888;
    margin-top: 5px; letter-spacing: 3px;
  }

  .divider {
    width: 80%; height: 1px;
    background: linear-gradient(to right, transparent, rgba(255,255,255,0.15), transparent);
    margin: 30px auto;
  }

  .suggest-title {
    font-size: 18px; color: #aaa;
    margin-bottom: 15px;
    letter-spacing: 2px;
  }

  .suggest-list {
    list-style: none; text-align: left;
    display: inline-block;
  }
  .suggest-list li {
    font-size: 16px; color: #999;
    padding: 8px 0;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    opacity: 0;
    animation: slide-in 0.4s forwards;
  }
  .suggest-list li:nth-child(1) { animation-delay: 0.3s; }
  .suggest-list li:nth-child(2) { animation-delay: 0.5s; }
  .suggest-list li:nth-child(3) { animation-delay: 0.7s; }
  .suggest-list li:nth-child(4) { animation-delay: 0.9s; }
  .suggest-list li:nth-child(5) { animation-delay: 1.1s; }

  @keyframes slide-in {
    from { transform: translateX(-20px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }

  .suggest-emoji { margin-right: 10px; }
  .suggest-effect {
    color: #44bb44; font-weight: 600;
    margin-left: 8px;
  }

  .footer {
    margin-top: 30px;
    font-size: 14px; color: #555;
    font-style: italic;
  }
</style>
</head>
<body>
  <div class="bg"></div>

  <div class="content">
    <div class="icon">💔</div>
    <div class="title">COMMIT REJECTED</div>
    <div class="reason">情熱が足りません。</div>

    <div class="stats">
      <div class="stat-box">
        <div class="stat-value current">♥ ${bpm}</div>
        <div class="stat-label">現在の心拍数</div>
      </div>
      <div class="stat-box">
        <div class="stat-value threshold">♥ ${THRESHOLD}</div>
        <div class="stat-label">必要な心拍数</div>
      </div>
      <div class="stat-box">
        <div class="stat-value deficit">+${deficit}</div>
        <div class="stat-label">不 足 分</div>
      </div>
    </div>

    <div class="divider"></div>

    <div class="suggest-title">💡 心拍を上げる方法</div>
    <ul class="suggest-list">
      <li><span class="suggest-emoji">🏃</span>階段ダッシュ<span class="suggest-effect">+60 bpm</span></li>
      <li><span class="suggest-emoji">⏰</span>締切ギリギリ駆動<span class="suggest-effect">+40 bpm</span></li>
      <li><span class="suggest-emoji">☕</span>エスプレッソ 3杯<span class="suggest-effect">+20 bpm</span></li>
      <li><span class="suggest-emoji">😱</span>本番環境で rm -rf<span class="suggest-effect">+100 bpm</span></li>
      <li><span class="suggest-emoji">💸</span>仮想通貨チャートを見る<span class="suggest-effect">+∞ bpm</span></li>
    </ul>

    <div class="footer">「平常心で書いたコードは、信用できない。」</div>
  </div>

  <script>
  </script>
</body>
</html>`;
}

// ──────────────────────────────────────────────
// 拡張機能のライフサイクル
// ──────────────────────────────────────────────
export function activate(context: vscode.ExtensionContext) {
  console.log("DDD extension activated");

  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBar.text = "$(heart) connecting...";
  statusBar.show();

  context.subscriptions.push(statusBar);

  connectWebSocket();
}

export function deactivate() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }
  if (ws) {
    ws.close();
  }
}
