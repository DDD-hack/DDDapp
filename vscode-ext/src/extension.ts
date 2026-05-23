import * as vscode from "vscode";
import { exec, spawn } from "child_process";
import { LockdownController } from "./lockdown";

// ──────────────────────────────────────────────
// モジュール状態
// ──────────────────────────────────────────────
let ws: WebSocket | null = null;
let statusBar: vscode.StatusBarItem;
let reconnectTimeout: NodeJS.Timeout | null = null;
let isDeactivating = false;
let extensionContext: vscode.ExtensionContext;
let afterglowTimer: NodeJS.Timeout | null = null;
let activeDecorations: vscode.TextEditorDecorationType[] = [];
let lockdownController: LockdownController | null = null;

// デモモード: 環境変数で閾値を変更可能（デフォルト120）
const THRESHOLD = Number(process.env.DDD_THRESHOLD) || 120;
const port = process.env.DDD_DAEMON_PORT || "8765";

// 設定キー
const CONFIG_NS = "ddd.presentation";
const STATE_STREAK_KEY = "ddd.passionStreak";
const STATE_BEST_KEY = "ddd.bestBpm";

// ──────────────────────────────────────────────
// 設定読み込み
// ──────────────────────────────────────────────
type Intensity = "calm" | "normal" | "intense";
type PresentationConfig = {
  intensity: Intensity;
  flashEnabled: boolean;
  soundEnabled: boolean;
  editorDecorations: boolean;
  comboTracking: boolean;
  fullScreenMode: boolean;
  codeInjection: boolean;
};

function readConfig(): PresentationConfig {
  const c = vscode.workspace.getConfiguration(CONFIG_NS);
  return {
    intensity: (c.get<Intensity>("intensity") ?? "normal"),
    flashEnabled: c.get<boolean>("flashEnabled") ?? true,
    soundEnabled: c.get<boolean>("soundEnabled") ?? true,
    editorDecorations: c.get<boolean>("editorDecorations") ?? true,
    comboTracking: c.get<boolean>("comboTracking") ?? true,
    fullScreenMode: c.get<boolean>("fullScreenMode") ?? true,
    codeInjection: c.get<boolean>("codeInjection") ?? true,
  };
}

// ──────────────────────────────────────────────
// Tier 判定 — BPM 帯ごとに演出を段階化
// ──────────────────────────────────────────────
type Tier = 1 | 2 | 3 | 4 | 5;

type TierAssets = {
  title: string;
  subtitle: string;
  bgColor: string;
  glowColor: string;
  particles: number;
  /** 称号ラベル（ハッカソンデモで一番目立つ部分） */
  rankLabel: string;
};

function bpmToTier(bpm: number): Tier {
  if (bpm >= 200) return 5;
  if (bpm >= 180) return 4;
  if (bpm >= 160) return 3;
  if (bpm >= 140) return 2;
  return 1;
}

function getTierAssets(tier: Tier): TierAssets {
  switch (tier) {
    case 5:
      return {
        title: "心臓破り",
        subtitle: "— 医療従事者を呼んでください —",
        bgColor: "rgba(180, 0, 60, 0.55)",
        glowColor: "#ff0066",
        particles: 80,
        rankLabel: "💀 LIFE THREATENING",
      };
    case 4:
      return {
        title: "LEGENDARY",
        subtitle: "— 伝説のコミット —",
        bgColor: "rgba(200, 30, 0, 0.45)",
        glowColor: "#ff2200",
        particles: 60,
        rankLabel: "👑 LEGENDARY",
      };
    case 3:
      return {
        title: "INTENSE",
        subtitle: "— 烈火のコミット —",
        bgColor: "rgba(220, 60, 0, 0.4)",
        glowColor: "#ff4500",
        particles: 45,
        rankLabel: "⚡ INTENSE",
      };
    case 2:
      return {
        title: "PASSIONATE",
        subtitle: "— 情熱のコミット —",
        bgColor: "rgba(255, 80, 0, 0.35)",
        glowColor: "#ff6a00",
        particles: 35,
        rankLabel: "🔥 PASSIONATE",
      };
    default:
      return {
        title: "ACCEPTED",
        subtitle: "— 情熱が認められました —",
        bgColor: "rgba(255, 100, 0, 0.3)",
        glowColor: "#ff8800",
        particles: 25,
        rankLabel: "🔥 ACCEPTED",
      };
  }
}

// ──────────────────────────────────────────────
// 多段サウンド — buildup → flash → main の 3 連
// ──────────────────────────────────────────────
function playStagedAcceptedSound(cfg: PresentationConfig) {
  if (!cfg.soundEnabled) return;

  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";

  if (isMac) {
    // 鼓動ドク ドク ドク → 主音
    const cmd = [
      "afplay /System/Library/Sounds/Tink.aiff",
      "sleep 0.25",
      "afplay /System/Library/Sounds/Tink.aiff",
      "sleep 0.2",
      "afplay /System/Library/Sounds/Pop.aiff",
      "sleep 0.15",
      "afplay /System/Library/Sounds/Hero.aiff",
    ].join(" && ");
    spawn("bash", ["-c", cmd], { detached: true, stdio: "ignore" }).unref();
  } else if (isWin) {
    // PowerShell で順次再生
    const cmd =
      `(New-Object Media.SoundPlayer 'C:\\Windows\\Media\\notify.wav').PlaySync(); ` +
      `(New-Object Media.SoundPlayer 'C:\\Windows\\Media\\notify.wav').PlaySync(); ` +
      `(New-Object Media.SoundPlayer 'C:\\Windows\\Media\\tada.wav').PlaySync()`;
    spawn("powershell", ["-c", cmd], { detached: true, stdio: "ignore" }).unref();
  }
}

function playRejectedSound(cfg: PresentationConfig) {
  if (!cfg.soundEnabled) return;
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";

  if (isMac) {
    const cmd = [
      "afplay /System/Library/Sounds/Funk.aiff",
      "sleep 0.1",
      "afplay /System/Library/Sounds/Basso.aiff",
    ].join(" && ");
    spawn("bash", ["-c", cmd], { detached: true, stdio: "ignore" }).unref();
  } else if (isWin) {
    exec(`powershell -c "(New-Object Media.SoundPlayer 'C:\\Windows\\Media\\chord.wav').PlaySync()"`);
  }
}

// ──────────────────────────────────────────────
// WebSocket 接続
// ──────────────────────────────────────────────
function connectWebSocket() {
  if (isDeactivating) return;
  if (ws) ws.close();

  ws = new WebSocket(`ws://localhost:${port}/ws/vscode`);

  ws.addEventListener("open", () => {
    console.log("DDD: Connected to daemon");
    statusBar.tooltip = "DDD: Connected";
  });

  ws.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data.toString());

      if (msg.type === "bpm" && typeof msg.bpm === "number" && Number.isFinite(msg.bpm)) {
        handleBpmUpdate(msg);
      } else if (msg.type === "commit_result" && typeof msg.bpm === "number" && Number.isFinite(msg.bpm)) {
        handleCommitResult(msg);
      }
    } catch (e) {
      console.error("DDD: Error parsing message", e);
    }
  });

  ws.addEventListener("close", () => {
    console.log("DDD: Disconnected from daemon");
    statusBar.text = `$(heart) disconnected`;
    statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    statusBar.tooltip = "DDD: Disconnected. Retrying in 5s...";

    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    if (!isDeactivating) {
      reconnectTimeout = setTimeout(connectWebSocket, 5000);
    }
  });

  ws.addEventListener("error", (event) => {
    console.error("DDD: WebSocket error", event);
    vscode.window.showErrorMessage("DDD: WebSocket接続エラー。デーモンが起動していない可能性があります。");
    ws?.close();
  });
}

// ──────────────────────────────────────────────
// ステータスバー更新（心拍数リアルタイム表示）
// ──────────────────────────────────────────────
function handleBpmUpdate(msg: { bpm: number; status?: string }) {
  // 余韻中はその表示を尊重（上書きしない）
  if (afterglowTimer) return;

  const bpm = msg.bpm;
  const stale = msg.status === "stale" || bpm === 0;

  // Lockdown が有効ならステータスバーは Lockdown 側に任せる
  if (lockdownController && lockdownController.shouldOwnStatusBar()) {
    lockdownController.setBpm(bpm, stale);
    lockdownController.updateStatusBar(bpm, stale);
    return;
  }

  if (stale) {
    statusBar.text = `$(heart) -- bpm`;
    statusBar.backgroundColor = undefined;
    statusBar.tooltip = "DDD: Stale data";
  } else {
    statusBar.text = `$(heart) ${bpm} bpm`;
    statusBar.tooltip = `DDD: ${bpm} bpm (閾値: ${THRESHOLD})`;
    statusBar.backgroundColor =
      bpm >= THRESHOLD ? new vscode.ThemeColor("statusBarItem.errorBackground") : undefined;
  }
}

// ──────────────────────────────────────────────
// コミット結果ハンドラ — 演出オーケストレーション
// ──────────────────────────────────────────────
function handleCommitResult(msg: { result: string; bpm: number }) {
  const cfg = readConfig();
  if (msg.result === "accepted") {
    runAcceptedFlow(msg.bpm, cfg);
  } else if (msg.result === "rejected") {
    runRejectedFlow(msg.bpm, cfg);
  }
}

function runAcceptedFlow(bpm: number, cfg: PresentationConfig) {
  const tier = bpmToTier(bpm);
  const streak = cfg.comboTracking ? bumpStreak(true) : 0;
  const best = updateBestBpm(bpm);
  const isNewRecord = best === bpm;

  // calm モードはトーストのみ
  if (cfg.intensity === "calm") {
    vscode.window.showInformationMessage(`🔥 ACCEPTED — ${bpm} bpm`);
    return;
  }

  playStagedAcceptedSound(cfg);

  // Tier 4-5 (LEGENDARY+) は全画面モード:
  //   - サイドバーを閉じる
  //   - メインパネルと並列に Achievement Card パネルを開く
  //   - 終了時にすべて復元
  const isLegendary = tier >= 4 && cfg.fullScreenMode;
  if (isLegendary) {
    enterFullScreenMode();
  }

  showAcceptedPanel(bpm, tier, streak, isNewRecord, cfg, isLegendary);

  if (isLegendary) {
    showAchievementCard(bpm, tier, streak, best, isNewRecord);
  }

  startAfterglow("accepted", cfg);
  burstToastsAccepted(bpm, tier, streak, isNewRecord);

  if (cfg.editorDecorations) {
    flashEditorRow("accepted", bpm);
  }
}

function runRejectedFlow(bpm: number, cfg: PresentationConfig) {
  if (cfg.comboTracking) bumpStreak(false);

  if (cfg.intensity === "calm") {
    vscode.window.showWarningMessage(`💔 REJECTED — ${bpm} bpm (必要 ${THRESHOLD})`);
    return;
  }

  playRejectedSound(cfg);
  showRejectionPanel(bpm, cfg);
  startAfterglow("rejected", cfg);

  if (cfg.editorDecorations) {
    flashEditorRow("rejected", bpm);
  }

  // ダメージコメントを編集中ファイルに 3 秒だけ挿入する（Phase 3-K）。
  // 安全弁: 設定 OFF / dirty document / アクティブエディタなし のいずれかでスキップ。
  if (cfg.codeInjection) {
    injectDamageComment(bpm).catch((err) => {
      console.warn("DDD: damage comment injection failed:", err);
    });
  }
}

// ──────────────────────────────────────────────
// 状態管理 — コンボストリーク & 自己ベスト
// ──────────────────────────────────────────────
function bumpStreak(accepted: boolean): number {
  const cur = extensionContext.globalState.get<number>(STATE_STREAK_KEY) ?? 0;
  const next = accepted ? cur + 1 : 0;
  extensionContext.globalState.update(STATE_STREAK_KEY, next);
  return next;
}

function updateBestBpm(bpm: number): number {
  const cur = extensionContext.globalState.get<number>(STATE_BEST_KEY) ?? 0;
  const next = Math.max(cur, bpm);
  if (next !== cur) {
    extensionContext.globalState.update(STATE_BEST_KEY, next);
  }
  return next;
}

// ──────────────────────────────────────────────
// 余韻 — ステータスバー 3 秒点滅
// ──────────────────────────────────────────────
function startAfterglow(kind: "accepted" | "rejected", cfg: PresentationConfig) {
  if (cfg.intensity === "calm") return;
  if (afterglowTimer) clearInterval(afterglowTimer);

  const duration = 3000;
  const interval = 200;
  let elapsed = 0;
  let on = false;

  const acceptedBg = new vscode.ThemeColor("statusBarItem.errorBackground");
  const rejectedBg = new vscode.ThemeColor("statusBarItem.warningBackground");

  afterglowTimer = setInterval(() => {
    on = !on;
    statusBar.text = on
      ? kind === "accepted"
        ? "$(flame) PASSION!"
        : "$(circle-slash) REJECTED"
      : "$(heart) ...";
    statusBar.backgroundColor = on ? (kind === "accepted" ? acceptedBg : rejectedBg) : undefined;

    elapsed += interval;
    if (elapsed >= duration) {
      if (afterglowTimer) clearInterval(afterglowTimer);
      afterglowTimer = null;
      // 通常表示に戻す（次の bpm メッセージで上書きされる）
      statusBar.text = `$(heart) ${THRESHOLD}+ bpm`;
      statusBar.backgroundColor = undefined;
    }
  }, interval);
}

// ──────────────────────────────────────────────
// エディタ装飾 — カーソル行を炎色に
// ──────────────────────────────────────────────
function flashEditorRow(kind: "accepted" | "rejected", bpm: number) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const isAccepted = kind === "accepted";
  const decoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: isAccepted ? "rgba(255, 80, 0, 0.3)" : "rgba(60, 60, 60, 0.5)",
    overviewRulerColor: isAccepted ? "#ff4500" : "#666",
    overviewRulerLane: vscode.OverviewRulerLane.Full,
    after: {
      contentText: isAccepted ? `    🔥 PASSION +${bpm} bpm` : `    💔 REJECTED at ${bpm} bpm`,
      color: isAccepted ? "#ff8844" : "#cc6666",
      fontWeight: "bold",
      margin: "0 0 0 2em",
    },
  });

  // 現在のカーソル位置を含む行に装飾を適用
  const line = editor.selection.active.line;
  const range = new vscode.Range(line, 0, line, 0);
  editor.setDecorations(decoration, [range]);
  activeDecorations.push(decoration);

  // 5 秒後に剥がす
  setTimeout(() => {
    decoration.dispose();
    activeDecorations = activeDecorations.filter((d) => d !== decoration);
  }, 5000);
}

// ──────────────────────────────────────────────
// 全画面モード（Phase 3-I）— サイドバー閉じ + 後で復元
// ──────────────────────────────────────────────
let fullScreenActive = false;

async function enterFullScreenMode() {
  if (fullScreenActive) return;
  fullScreenActive = true;
  try {
    // closeSidebar は既に閉じていても安全に no-op
    await vscode.commands.executeCommand("workbench.action.closeSidebar");
    // 下部パネル（ターミナル等）も閉じて画面占有度を最大化
    await vscode.commands.executeCommand("workbench.action.closePanel");
  } catch (err) {
    console.warn("DDD: failed to enter full screen mode:", err);
  }
}

async function exitFullScreenMode() {
  if (!fullScreenActive) return;
  fullScreenActive = false;
  try {
    // toggleSidebarVisibility は閉じていれば開く
    await vscode.commands.executeCommand("workbench.action.toggleSidebarVisibility");
  } catch (err) {
    console.warn("DDD: failed to restore sidebar:", err);
  }
}

// ──────────────────────────────────────────────
// コード一時挿入（Phase 3-K）
//   REJECTED 時に編集中ファイルへダメージコメントを差し込み、3秒後に削除する。
//   安全装置:
//     • アクティブエディタなし → スキップ
//     • dirty なドキュメント（ユーザー作業中）→ スキップ（作業を壊さない）
//     • コメント構文が分からない言語 → // にフォールバック（コードとして無効でも視覚効果優先）
//     • 削除はテキスト一致による厳密マッチ。一致しない時は何もせず終了
// ──────────────────────────────────────────────
function commentSyntaxForLang(langId: string): { open: string; close: string } {
  switch (langId) {
    case "html":
    case "xml":
    case "markdown":
      return { open: "<!-- ", close: " -->" };
    case "python":
    case "ruby":
    case "shellscript":
    case "yaml":
    case "toml":
    case "dockerfile":
      return { open: "# ", close: "" };
    case "css":
    case "scss":
      return { open: "/* ", close: " */" };
    default:
      return { open: "// ", close: "" };
  }
}

async function injectDamageComment(bpm: number) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  // dirty な場合は触らない（ユーザーの未保存変更を壊さない安全弁）
  if (editor.document.isDirty) return;

  const { open, close } = commentSyntaxForLang(editor.document.languageId);
  const deficit = THRESHOLD - bpm;
  // 単一行で挿入 → 削除を簡単に
  const damageText = `${open}💀 REJECTED at ${bpm} bpm — passion deficit: +${deficit}${close}\n`;

  // 現在カーソル位置の行頭に挿入する
  const insertLine = editor.selection.active.line;
  const insertPos = new vscode.Position(insertLine, 0);

  let inserted = false;
  try {
    inserted = await editor.edit((eb) => eb.insert(insertPos, damageText), {
      undoStopBefore: false,
      undoStopAfter: false,
    });
  } catch (err) {
    console.warn("DDD: edit failed:", err);
    return;
  }
  if (!inserted) return;

  // 3 秒後に挿入したテキストを正確に削除する
  setTimeout(async () => {
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.document.uri.toString() !== editor.document.uri.toString()) {
      return; // ユーザーがファイルを切り替えた -> 触らない
    }
    // 挿入行の現在のテキストが damageText と一致するか確認
    if (insertLine >= ed.document.lineCount) return;
    const lineText = ed.document.lineAt(insertLine).text + "\n";
    if (lineText !== damageText) {
      // ユーザーが何か書いた → 触らない
      return;
    }
    try {
      const range = new vscode.Range(insertLine, 0, insertLine + 1, 0);
      await ed.edit((eb) => eb.delete(range), {
        undoStopBefore: false,
        undoStopAfter: false,
      });
    } catch (err) {
      console.warn("DDD: damage comment cleanup failed:", err);
    }
  }, 3000);
}

// ──────────────────────────────────────────────
// トースト連射 — 主演出と並行して通知エリアに重ねる
// ──────────────────────────────────────────────
function burstToastsAccepted(bpm: number, tier: Tier, streak: number, isNewRecord: boolean) {
  const tierAssets = getTierAssets(tier);
  // 主パネル開始から少し遅れて 3 連射
  setTimeout(() => vscode.window.showInformationMessage(`🔥 +${bpm} BPM`), 1200);
  setTimeout(() => vscode.window.showInformationMessage(`${tierAssets.rankLabel}`), 1800);

  if (isNewRecord) {
    setTimeout(() => vscode.window.showInformationMessage("👑 NEW PERSONAL BEST!"), 2400);
  } else if (streak >= 3) {
    const comboLabel =
      streak >= 10 ? `👑 GODLIKE — ${streak} 連続` :
      streak >= 5  ? `⚡ INSANE — ${streak} 連続` :
                     `🔥 ${streak}x COMBO`;
    setTimeout(() => vscode.window.showInformationMessage(comboLabel), 2400);
  }
}

// ──────────────────────────────────────────────
// 成功パネル
// ──────────────────────────────────────────────
function showAcceptedPanel(
  bpm: number,
  tier: Tier,
  streak: number,
  isNewRecord: boolean,
  cfg: PresentationConfig,
  isLegendary: boolean,
) {
  const panel = vscode.window.createWebviewPanel(
    "dddCommitAccepted",
    `🔥 ${getTierAssets(tier).title}`,
    vscode.ViewColumn.Active, // ← Active で現在のフォーカスエリアを占有
    { enableScripts: true, retainContextWhenHidden: false }
  );

  panel.webview.html = getAcceptedHtml(bpm, tier, streak, isNewRecord, cfg);

  // tier が高いほど長く残す（Tier4-5 は撮影タイム）
  const dwellMs = tier >= 4 ? 12000 : tier >= 2 ? 9000 : 7000;
  setTimeout(() => {
    if (panel.visible) panel.dispose();
    // 全画面モードに入っていれば、メインパネル閉じた時に解除
    if (isLegendary) {
      exitFullScreenMode();
    }
  }, dwellMs);

  // ユーザーが手動で閉じた場合も復元
  panel.onDidDispose(() => {
    if (isLegendary) exitFullScreenMode();
  });
}

// ──────────────────────────────────────────────
// Achievement Card パネル（Phase 3-I）— Tier 4-5 で並列表示
// ──────────────────────────────────────────────
function showAchievementCard(
  bpm: number,
  tier: Tier,
  streak: number,
  best: number,
  isNewRecord: boolean,
) {
  const panel = vscode.window.createWebviewPanel(
    "dddAchievement",
    "🏆 ACHIEVEMENT",
    vscode.ViewColumn.Beside, // メインパネルの隣
    { enableScripts: true, retainContextWhenHidden: false }
  );
  panel.webview.html = getAchievementCardHtml(bpm, tier, streak, best, isNewRecord);

  // メインパネルと同じ尺で閉じる
  setTimeout(() => {
    if (panel.visible) panel.dispose();
  }, 12000);
}

// ──────────────────────────────────────────────
// 拒否パネル
// ──────────────────────────────────────────────
function showRejectionPanel(bpm: number, cfg: PresentationConfig) {
  const panel = vscode.window.createWebviewPanel(
    "dddCommitRejected",
    "💔 COMMIT REJECTED",
    vscode.ViewColumn.Active,
    { enableScripts: true }
  );
  panel.webview.html = getRejectedHtml(bpm, cfg);
  // rejected は時間をかけて見せる（拒否されたら作業中断するくらいで丁度いい）
  setTimeout(() => {
    if (panel.visible) panel.dispose();
  }, 14000);
}

// ──────────────────────────────────────────────
// 成功 HTML — buildup → flash → main → afterglow
// ──────────────────────────────────────────────
function getAcceptedHtml(
  bpm: number,
  tier: Tier,
  streak: number,
  isNewRecord: boolean,
  cfg: PresentationConfig,
): string {
  const a = getTierAssets(tier);
  const flashEnabled = cfg.flashEnabled && cfg.intensity !== "calm";
  const intense = cfg.intensity === "intense";

  // intense では buildup を長く、calm では skip
  const buildupHtml = flashEnabled
    ? `
    <div class="buildup" id="buildup">
      <div class="bd-pulse"></div>
      <div class="bd-pulse delay-1"></div>
      <div class="bd-pulse delay-2"></div>
      <div class="bd-flash"></div>
    </div>`
    : "";

  const streakBadge = streak >= 3
    ? `<div class="streak">${streak >= 10 ? "👑" : streak >= 5 ? "⚡" : "🔥"} ${streak}x COMBO</div>`
    : "";

  const recordBadge = isNewRecord ? `<div class="record">👑 NEW PERSONAL BEST</div>` : "";

  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:100vw; height:100vh; overflow:hidden;
    display:flex; align-items:center; justify-content:center;
    background:#0a0a0a;
    font-family:'Segoe UI','Yu Gothic UI',sans-serif;
    color:#fff;
  }

  /* ─── Buildup（予告フェーズ）────────── */
  .buildup {
    position:fixed; inset:0; z-index:999;
    background:#000;
    display:flex; align-items:center; justify-content:center;
    pointer-events:none;
  }
  .bd-pulse {
    position:absolute;
    width:300px; height:300px; border-radius:50%;
    background:radial-gradient(circle, ${a.glowColor}, transparent 70%);
    animation:bd-pump 0.55s ease-out forwards;
    opacity:0;
  }
  .bd-pulse.delay-1 { animation-delay:0.55s; }
  .bd-pulse.delay-2 { animation-delay:1.10s; }
  @keyframes bd-pump {
    0%   { transform:scale(0.2); opacity:0; }
    30%  { opacity:0.9; }
    100% { transform:scale(1.4); opacity:0; }
  }
  .bd-flash {
    position:absolute; inset:0;
    background:#fff;
    opacity:0;
    animation:bd-flash 0.35s 1.55s forwards;
  }
  @keyframes bd-flash {
    0%   { opacity:0; }
    20%  { opacity:1; }
    100% { opacity:0; }
  }
  .buildup.gone { display:none; }

  /* ─── 主演出（メイン）───────────────── */
  .bg {
    position:fixed; inset:0;
    background:radial-gradient(ellipse at center,
      ${a.bgColor} 0%,
      rgba(60,10,0,0.25) 40%,
      rgba(10,10,10,1) 70%);
    animation:pulse-bg 1.4s ease-in-out infinite alternate;
    opacity:0;
    animation-fill-mode:both;
    animation-delay:1.8s;
  }
  .bg.visible {
    opacity:1;
    animation:pulse-bg 1.4s ease-in-out infinite alternate;
  }
  @keyframes pulse-bg { 0%{opacity:0.65;} 100%{opacity:1;} }

  .content {
    position:relative; z-index:2;
    text-align:center;
    opacity:0;
    animation:fade-up 0.6s 1.85s forwards;
  }
  @keyframes fade-up {
    from { transform:translateY(20px); opacity:0; }
    to   { transform:translateY(0);    opacity:1; }
  }

  .fire-emoji { font-size:88px; animation:bounce 0.6s ease-in-out infinite alternate; }
  @keyframes bounce { 0%{transform:translateY(0) scale(1);} 100%{transform:translateY(-15px) scale(1.1);} }

  .rank {
    display:inline-block;
    margin-top:14px;
    padding:6px 18px;
    font-size:14px; letter-spacing:6px; font-weight:700;
    color:#fff;
    background:rgba(255,255,255,0.06);
    border:1px solid ${a.glowColor};
    border-radius:999px;
    text-shadow:0 0 12px ${a.glowColor};
  }

  .title {
    font-size:64px; font-weight:900;
    color:#fff;
    text-shadow:
      0 0 20px ${a.glowColor},
      0 0 40px ${a.glowColor},
      0 0 80px ${a.glowColor},
      0 0 120px #ff0000;
    animation:glow 1.2s ease-in-out infinite alternate;
    margin:18px 0 10px;
    letter-spacing:6px;
  }
  @keyframes glow {
    0%   { filter:brightness(1.0); }
    100% { filter:brightness(1.3); }
  }

  .subtitle {
    font-size:24px; color:${a.glowColor};
    font-weight:600;
    opacity:0;
    animation:fade-in 0.7s 2.4s forwards;
  }
  @keyframes fade-in { to { opacity:1; } }

  .bpm-display {
    margin-top:28px;
    font-size:96px; font-weight:900;
    color:${a.glowColor};
    text-shadow:0 0 32px ${a.glowColor};
    animation:heartbeat 0.85s ease-in-out infinite;
  }
  @keyframes heartbeat {
    0%,100%{transform:scale(1);}
    15%{transform:scale(1.18);}
    30%{transform:scale(1);}
    45%{transform:scale(1.12);}
  }
  .bpm-label { font-size:20px; color:#aaa; margin-top:4px; letter-spacing:8px; }

  .streak, .record {
    display:inline-block;
    margin-top:18px;
    padding:8px 24px;
    font-size:18px; font-weight:700; letter-spacing:3px;
    background:rgba(255,200,0,0.12);
    border:1px solid #ffaa00;
    border-radius:8px;
    color:#ffcc44;
    opacity:0;
    animation:fade-in 0.7s 2.8s forwards;
  }
  .record {
    border-color:#ff66cc;
    color:#ff99dd;
    background:rgba(255,100,200,0.12);
  }

  .message {
    margin-top:24px;
    font-size:16px; color:#888;
    opacity:0;
    animation:fade-in 0.8s 3.2s forwards;
  }

  /* 火の粉パーティクル */
  .particle {
    position:fixed; bottom:-30px;
    font-size:30px;
    animation:rise linear infinite;
    opacity:0.85;
    animation-delay:2s;
  }
  @keyframes rise {
    0%   { transform:translateY(0) rotate(0deg); opacity:0.9; }
    100% { transform:translateY(-115vh) rotate(720deg); opacity:0; }
  }
</style></head><body>
  ${buildupHtml}

  <div class="bg" id="bg"></div>

  <div class="content">
    <div class="fire-emoji">${tier >= 4 ? "🔥💥🔥" : "🔥🔥🔥"}</div>
    <div class="rank">${a.rankLabel}</div>
    <div class="title">${a.title}</div>
    <div class="subtitle">${a.subtitle}</div>
    <div class="bpm-display">♥ ${bpm}</div>
    <div class="bpm-label">B P M</div>
    ${recordBadge}
    ${streakBadge}
    <div class="message">${
      tier >= 4
        ? "歴史に残るコミットです。後世に語り継がれるでしょう。"
        : tier >= 2
        ? "情熱がコードに宿りました。"
        : "このコミットは情熱によって承認されました。"
    }</div>
  </div>

  <script>
    // buildup 終了後にメイン背景を出す
    setTimeout(() => {
      const bu = document.getElementById('buildup');
      if (bu) bu.classList.add('gone');
      const bg = document.getElementById('bg');
      if (bg) bg.classList.add('visible');
    }, 1900);

    // 火の粉パーティクル生成（Tier 連動）
    const emojis = ['🔥','✨','💛','🧡','❤️‍🔥'${tier >= 4 ? ",'💥','⭐'" : ""}];
    const count = ${a.particles}${intense ? " * 2" : ""};
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      p.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      p.style.left = Math.random() * 100 + 'vw';
      p.style.animationDuration = (2 + Math.random() * 4) + 's';
      p.style.animationDelay = (2 + Math.random() * 3) + 's';
      p.style.fontSize = (20 + Math.random() * 30) + 'px';
      document.body.appendChild(p);
    }
  </script>
</body></html>`;
}

// ──────────────────────────────────────────────
// Achievement Card HTML（Phase 3-I）
//   メインパネルの隣に並べる。RPG 風の称号アンロック演出。
// ──────────────────────────────────────────────
function getAchievementCardHtml(
  bpm: number,
  tier: Tier,
  streak: number,
  best: number,
  isNewRecord: boolean,
): string {
  const a = getTierAssets(tier);
  const rarity = tier >= 5 ? "MYTHIC" : tier >= 4 ? "LEGENDARY" : "EPIC";

  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:100vw; height:100vh; overflow:hidden;
    background:#0a0a0a;
    color:#fff;
    font-family:'Segoe UI','Yu Gothic UI',sans-serif;
    display:flex; align-items:center; justify-content:center;
  }
  .card {
    width:80%; max-width:520px;
    padding:48px 40px;
    border-radius:24px;
    background:linear-gradient(145deg,
      rgba(40,20,0,0.85),
      rgba(20,10,0,0.95));
    border:2px solid ${a.glowColor};
    box-shadow:
      0 0 30px ${a.glowColor},
      inset 0 0 40px rgba(255,80,0,0.15);
    text-align:center;
    position:relative;
    opacity:0; transform:translateY(40px) scale(0.9);
    animation:card-in 1.0s 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  }
  @keyframes card-in {
    to { opacity:1; transform:translateY(0) scale(1); }
  }

  .rarity {
    font-size:14px; font-weight:900; letter-spacing:8px;
    color:${a.glowColor};
    text-shadow:0 0 12px ${a.glowColor};
    opacity:0;
    animation:fade-in 0.6s 1.4s forwards;
  }
  .unlock {
    margin-top:6px;
    font-size:11px; color:#888; letter-spacing:4px;
    opacity:0;
    animation:fade-in 0.6s 1.6s forwards;
  }
  @keyframes fade-in { to { opacity:1; } }

  .icon {
    font-size:96px;
    margin:20px 0 10px;
    filter:drop-shadow(0 0 24px ${a.glowColor});
    animation:trophy-bounce 1.4s 1.8s ease-out;
  }
  @keyframes trophy-bounce {
    0% { transform:translateY(-80px) rotate(-15deg); opacity:0; }
    60% { transform:translateY(8px) rotate(5deg); opacity:1; }
    80% { transform:translateY(-4px) rotate(-2deg); }
    100% { transform:translateY(0) rotate(0); }
  }

  .title {
    font-size:36px; font-weight:900;
    letter-spacing:4px;
    color:#fff;
    text-shadow:0 0 16px ${a.glowColor};
    opacity:0;
    animation:fade-in 0.6s 2.4s forwards;
  }
  .subtitle {
    font-size:14px; color:#aaa;
    margin-top:8px;
    opacity:0;
    animation:fade-in 0.6s 2.6s forwards;
  }

  .stats {
    margin-top:32px;
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:12px;
    opacity:0;
    animation:fade-in 0.6s 2.9s forwards;
  }
  .stat {
    padding:14px 12px;
    background:rgba(255,255,255,0.04);
    border:1px solid rgba(255,255,255,0.08);
    border-radius:12px;
  }
  .stat-value {
    font-size:28px; font-weight:900;
    color:${a.glowColor};
    text-shadow:0 0 8px ${a.glowColor};
  }
  .stat-label {
    font-size:11px; color:#888;
    letter-spacing:2px;
    margin-top:4px;
  }

  .badges {
    margin-top:18px;
    display:flex;
    flex-wrap:wrap;
    justify-content:center;
    gap:8px;
    opacity:0;
    animation:fade-in 0.6s 3.3s forwards;
  }
  .badge {
    padding:6px 14px;
    font-size:13px; font-weight:700;
    border-radius:999px;
    background:rgba(255,200,0,0.12);
    border:1px solid #ffaa00;
    color:#ffcc44;
    letter-spacing:1px;
  }
  .badge.record {
    border-color:#ff66cc;
    color:#ff99dd;
    background:rgba(255,100,200,0.12);
  }

  /* 周辺の光輪 */
  .halo {
    position:fixed;
    width:600px; height:600px;
    border-radius:50%;
    background:radial-gradient(circle, ${a.glowColor}40, transparent 60%);
    top:50%; left:50%;
    transform:translate(-50%,-50%);
    animation:halo-pulse 3s ease-in-out infinite alternate;
    pointer-events:none;
  }
  @keyframes halo-pulse {
    0% { opacity:0.4; transform:translate(-50%,-50%) scale(1.0); }
    100% { opacity:0.7; transform:translate(-50%,-50%) scale(1.1); }
  }
</style></head><body>
  <div class="halo"></div>
  <div class="card">
    <div class="rarity">${rarity} RANK</div>
    <div class="unlock">— TROPHY UNLOCKED —</div>
    <div class="icon">${tier >= 5 ? "💀" : "🏆"}</div>
    <div class="title">${a.title}</div>
    <div class="subtitle">${a.subtitle}</div>

    <div class="stats">
      <div class="stat">
        <div class="stat-value">♥ ${bpm}</div>
        <div class="stat-label">BPM ACHIEVED</div>
      </div>
      <div class="stat">
        <div class="stat-value">${best}</div>
        <div class="stat-label">PERSONAL BEST</div>
      </div>
    </div>

    <div class="badges">
      ${isNewRecord ? '<div class="badge record">👑 NEW PB</div>' : ""}
      ${streak >= 3 ? `<div class="badge">${streak >= 10 ? "👑 GODLIKE" : streak >= 5 ? "⚡ INSANE" : "🔥"} ${streak}x COMBO</div>` : ""}
      <div class="badge">Tier ${tier}</div>
    </div>
  </div>
</body></html>`;
}

// ──────────────────────────────────────────────
// 拒否 HTML — フリーズ → 崩壊 → 主演出
// ──────────────────────────────────────────────
function getRejectedHtml(bpm: number, cfg: PresentationConfig): string {
  const deficit = THRESHOLD - bpm;
  const intense = cfg.intensity === "intense";

  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:100vw; height:100vh; overflow:hidden;
    display:flex; align-items:center; justify-content:center;
    background:#0a0a0a;
    font-family:'Segoe UI','Yu Gothic UI',sans-serif;
    color:#fff;
  }

  /* ─── フリーズ → グリッチ ─────────── */
  .freeze {
    position:fixed; inset:0; z-index:999;
    background:rgba(40,40,40,0.95);
    filter:grayscale(1) blur(2px);
    pointer-events:none;
    animation:freeze-out 0.4s 0.4s forwards;
  }
  @keyframes freeze-out { to { opacity:0; } }

  .glitch {
    position:fixed; inset:0; z-index:998;
    pointer-events:none;
    opacity:0;
    animation:glitch-show 1.2s 0.4s;
  }
  @keyframes glitch-show {
    0%,100% { opacity:0; }
    10%,30%,60% { opacity:1; }
    20%,50%,90% { opacity:0.3; }
  }
  .glitch::before, .glitch::after {
    content:'COMMIT REJECTED';
    position:absolute;
    top:50%; left:50%;
    transform:translate(-50%, -50%);
    font-size:60px; font-weight:900; letter-spacing:5px;
  }
  .glitch::before { color:#f00; transform:translate(-52%, -50%); mix-blend-mode:screen; }
  .glitch::after  { color:#0ff; transform:translate(-48%, -50%); mix-blend-mode:screen; }

  /* ─── SVG ノイズ（turbulence）— Phase 3-J ────── */
  .noise {
    position:fixed; inset:0; z-index:997;
    pointer-events:none;
    opacity:0;
    mix-blend-mode:overlay;
    animation:noise-flicker 1.4s 0.5s;
  }
  @keyframes noise-flicker {
    0%,100% { opacity:0; }
    10%,30%,60%,80% { opacity:0.6; }
    20%,50%,70% { opacity:0.25; }
  }

  /* ─── スキャンライン（CRT 風） ───────── */
  .scanlines {
    position:fixed; inset:0; z-index:996;
    pointer-events:none;
    background:repeating-linear-gradient(
      to bottom,
      transparent 0px,
      transparent 2px,
      rgba(0,0,0,0.18) 3px,
      rgba(0,0,0,0.18) 4px
    );
    opacity:0;
    animation:scanlines-in 0.6s 0.4s forwards, scanlines-out 1.0s 8.0s forwards;
  }
  @keyframes scanlines-in { to { opacity:0.7; } }
  @keyframes scanlines-out { to { opacity:0; } }

  /* ─── 画面ヒビ（12 ピースの clip-path 三角形） ─── */
  .crack {
    position:fixed; inset:0; z-index:995;
    pointer-events:none;
    opacity:0;
    animation:crack-show 0.4s 0.9s forwards, crack-fade 2.0s 8.0s forwards;
  }
  @keyframes crack-show { to { opacity:0.85; } }
  @keyframes crack-fade { to { opacity:0; } }
  .crack svg { width:100%; height:100%; }
  .crack line {
    stroke:#fff;
    stroke-width:1.2;
    opacity:0.6;
    filter:drop-shadow(0 0 3px rgba(255,255,255,0.5));
  }
  .crack line.bold { stroke-width:2.4; opacity:0.85; }

  /* ─── 主演出 ─────────────────────── */
  .bg {
    position:fixed; inset:0;
    background:radial-gradient(ellipse at center,
      rgba(180,0,0,0.2) 0%,
      rgba(60,0,0,0.1) 40%,
      rgba(10,10,10,1) 70%);
    animation:throb 2s ease-in-out infinite alternate;
    opacity:0;
    animation-fill-mode:both;
    animation-delay:1.6s;
  }
  .bg.visible { opacity:1; animation:throb 2s ease-in-out infinite alternate; }
  @keyframes throb { 0%{opacity:0.55;} 100%{opacity:1;} }

  .content {
    position:relative; z-index:2;
    text-align:center;
    max-width:760px;
    opacity:0;
    animation:fade-up 0.6s 1.65s forwards;
  }
  @keyframes fade-up {
    from { transform:translateY(20px); opacity:0; }
    to   { transform:translateY(0);    opacity:1; }
  }

  .icon { font-size:88px; animation:shake 0.5s ease-in-out infinite; }
  @keyframes shake {
    0%,100%{transform:translateX(0);}
    25%{transform:translateX(-8px) rotate(-3deg);}
    75%{transform:translateX(8px) rotate(3deg);}
  }

  .title {
    font-size:52px; font-weight:900;
    color:#ff2222;
    text-shadow:0 0 22px rgba(255,0,0,0.6);
    margin:15px 0;
    letter-spacing:4px;
  }

  .reason { font-size:22px; color:#cc6666; margin:10px 0 30px; }

  .stats { display:flex; justify-content:center; gap:50px; margin:20px 0; }
  .stat-box {
    text-align:center;
    padding:22px 32px;
    border-radius:16px;
    background:rgba(255,255,255,0.05);
    border:1px solid rgba(255,255,255,0.1);
  }
  .stat-value { font-size:54px; font-weight:900; }
  .stat-value.current   { color:#6688cc; }
  .stat-value.threshold { color:#ff4444; }
  .stat-value.deficit   { color:#ffaa00; }
  .stat-label { font-size:13px; color:#888; margin-top:5px; letter-spacing:3px; }

  .divider {
    width:80%; height:1px;
    background:linear-gradient(to right, transparent, rgba(255,255,255,0.15), transparent);
    margin:30px auto;
  }

  .suggest-title { font-size:18px; color:#aaa; margin-bottom:15px; letter-spacing:2px; }
  .suggest-list { list-style:none; text-align:left; display:inline-block; }
  .suggest-list li {
    font-size:16px; color:#999;
    padding:8px 0;
    border-bottom:1px solid rgba(255,255,255,0.05);
    opacity:0;
    animation:slide-in 0.4s forwards;
  }
  .suggest-list li:nth-child(1) { animation-delay:2.0s; }
  .suggest-list li:nth-child(2) { animation-delay:2.2s; }
  .suggest-list li:nth-child(3) { animation-delay:2.4s; }
  .suggest-list li:nth-child(4) { animation-delay:2.6s; }
  .suggest-list li:nth-child(5) { animation-delay:2.8s; }
  @keyframes slide-in {
    from { transform:translateX(-20px); opacity:0; }
    to   { transform:translateX(0); opacity:1; }
  }
  .suggest-emoji { margin-right:10px; }
  .suggest-effect { color:#44bb44; font-weight:600; margin-left:8px; }

  .footer { margin-top:30px; font-size:14px; color:#555; font-style:italic; }
</style></head><body>
  <div class="freeze"></div>
  <div class="glitch"></div>

  <!-- SVG turbulence ノイズ -->
  <svg class="noise" xmlns="http://www.w3.org/2000/svg">
    <filter id="noise-filter">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch"/>
      <feColorMatrix values="0 0 0 0 1
                             0 0 0 0 1
                             0 0 0 0 1
                             0 0 0 0.6 0"/>
    </filter>
    <rect width="100%" height="100%" filter="url(#noise-filter)"/>
  </svg>

  <div class="scanlines"></div>

  <!-- 画面ヒビ（SVG 線で表現） -->
  <div class="crack">
    <svg viewBox="0 0 1000 700" preserveAspectRatio="none">
      <!-- 中心から放射する亀裂 -->
      <line class="bold" x1="500" y1="350" x2="120" y2="60"/>
      <line class="bold" x1="500" y1="350" x2="900" y2="120"/>
      <line class="bold" x1="500" y1="350" x2="200" y2="660"/>
      <line class="bold" x1="500" y1="350" x2="850" y2="640"/>
      <line class="bold" x1="500" y1="350" x2="60" y2="380"/>
      <line class="bold" x1="500" y1="350" x2="970" y2="300"/>
      <!-- 細い枝亀裂 -->
      <line x1="300" y1="200" x2="380" y2="50"/>
      <line x1="700" y1="220" x2="780" y2="30"/>
      <line x1="350" y1="520" x2="280" y2="680"/>
      <line x1="650" y1="500" x2="720" y2="680"/>
      <line x1="200" y1="350" x2="50" y2="240"/>
      <line x1="800" y1="350" x2="950" y2="450"/>
    </svg>
  </div>

  <div class="bg" id="bg"></div>

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
    setTimeout(() => {
      const bg = document.getElementById('bg');
      if (bg) bg.classList.add('visible');
    }, 1700);
    ${intense ? `
    // intense モード: 軽い画面振動
    const body = document.body;
    let t = 0;
    const shakeId = setInterval(() => {
      t++;
      body.style.transform = 'translate(' + (Math.random()*4-2) + 'px,' + (Math.random()*4-2) + 'px)';
      if (t > 30) { clearInterval(shakeId); body.style.transform = ''; }
    }, 40);
    ` : ""}
  </script>
</body></html>`;
}

// ──────────────────────────────────────────────
// 拡張機能のライフサイクル
// ──────────────────────────────────────────────
export function activate(context: vscode.ExtensionContext) {
  console.log("DDD extension activated");
  extensionContext = context;

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = "$(heart) connecting...";
  statusBar.show();
  context.subscriptions.push(statusBar);

  // 起動時に過去の自己ベストをトーストで表示（軽い継続性演出）
  const best = context.globalState.get<number>(STATE_BEST_KEY);
  if (best && best >= THRESHOLD) {
    setTimeout(() => {
      vscode.window.setStatusBarMessage(`👑 自己ベスト ${best} bpm — 今日もそれを超えていけ`, 5000);
    }, 1500);
  }

  // Lockdown Mode コントローラ
  lockdownController = new LockdownController(statusBar);
  lockdownController.activate(context);

  connectWebSocket();
}

export function deactivate() {
  isDeactivating = true;
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  if (afterglowTimer) clearInterval(afterglowTimer);
  activeDecorations.forEach((d) => d.dispose());
  activeDecorations = [];
  // Lockdown を必ず解除してから終了（ロックされたまま終わると次回起動が困る）
  lockdownController?.deactivate().catch(() => {/* 無視 */});
  lockdownController = null;
  if (ws) ws.close();
}
