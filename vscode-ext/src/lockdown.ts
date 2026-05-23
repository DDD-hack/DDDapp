import * as vscode from "vscode";

// ──────────────────────────────────────────────
// Lockdown Mode — BPM が閾値以下のときコード入力をブロック
//
// 主防御: vscode.commands.registerCommand("type", ...) で
//   キーボード入力を 1 文字ずつ intercept する（VSCodeVim と同じ仕組み）。
// 副防御: blockPaste 時に onDidChangeTextDocument で paste 由来の変更を
//   undo で巻き戻す。
// 視覚演出: ステータスバー赤フラッシュ、トースト（throttle）、
//   intense 時はカーソル行を decoration で振動させる。
// ──────────────────────────────────────────────

const CONFIG_NS = "ddd.lockdown";
const TOAST_THROTTLE_MS = 3000;
const FEEDBACK_FLASH_MS = 200;

export type LockdownIntensity = "soft" | "standard" | "intense";

export interface LockdownConfig {
  enabled: boolean;
  threshold: number;
  intensity: LockdownIntensity;
  graceCharacters: number;
  filePatterns: string[];
  blockPaste: boolean;
  readonlyDefense: boolean;
  skipIfVimDetected: boolean;
}

type TypeCommandArgs = { text: string };

export class LockdownController {
  private active = false;
  private currentBpm = 0;
  private graceRemaining = 0;
  private typeDisposable: vscode.Disposable | null = null;
  private pasteListener: vscode.Disposable | null = null;
  private cfgChangeListener: vscode.Disposable | null = null;
  private myReadonlyApplied = false;
  private lastToastAt = 0;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private cfg: LockdownConfig;

  constructor(private statusBar: vscode.StatusBarItem) {
    this.cfg = this.readConfig();
  }

  activate(context: vscode.ExtensionContext): void {
    // コマンド登録 — 拡張機能のライフサイクルと一緒に
    context.subscriptions.push(
      vscode.commands.registerCommand("ddd.lockdown.toggle", () => this.toggle()),
      vscode.commands.registerCommand("ddd.lockdown.start", () => this.start()),
      vscode.commands.registerCommand("ddd.lockdown.stop", () => this.stop()),
      vscode.commands.registerCommand("ddd.lockdown.forceUnlock", () => this.forceUnlock()),
    );

    // 設定変更を監視
    this.cfgChangeListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_NS)) {
        this.cfg = this.readConfig();
      }
    });
    context.subscriptions.push(this.cfgChangeListener);

    // 自動起動（設定 enabled が true のとき）
    if (this.cfg.enabled) {
      // 拡張ロード直後は他の type 登録が走り終わっていない可能性があるので
      // 少し遅らせて start する
      setTimeout(() => this.start(), 300);
    }
  }

  async deactivate(): Promise<void> {
    await this.stop();
    this.cfgChangeListener?.dispose();
  }

  // ───── 公開メソッド（extension.ts から呼ばれる） ─────

  /** WS から届いた BPM を反映。閾値超過で grace カウンタが回復する。 */
  setBpm(bpm: number, stale: boolean): void {
    if (stale) {
      // 計測が途絶えた間は古い値を保持する（即ロックすると iPhone 持ち忘れで詰む）
      return;
    }
    this.currentBpm = bpm;
    if (bpm >= this.cfg.threshold) {
      this.graceRemaining = this.cfg.graceCharacters;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  /** Lockdown 起動中はステータスバーを支配する。 */
  shouldOwnStatusBar(): boolean {
    return this.active;
  }

  /** 拡張側の handleBpmUpdate から呼ばれる。Lockdown 状態を反映した表示にする。 */
  updateStatusBar(bpm: number, stale: boolean): void {
    if (!this.active) return;
    if (stale) {
      this.statusBar.text = "$(lock) LOCKED — 計測停止中";
      this.statusBar.tooltip = "DDD Lockdown 有効。計測が再開するまで現状維持。";
      this.statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      return;
    }
    if (bpm >= this.cfg.threshold) {
      // 解除中 — 通常 BPM 表示
      this.statusBar.text = `$(flame) ${bpm} bpm — 書ける!`;
      this.statusBar.tooltip = `DDD Lockdown: 通行許可中（${bpm} bpm / 必要 ${this.cfg.threshold} bpm）`;
      this.statusBar.backgroundColor = undefined;
    } else {
      const deficit = this.cfg.threshold - bpm;
      this.statusBar.text = `$(lock) LOCKED ${bpm} bpm (+${deficit} 必要)`;
      this.statusBar.tooltip = `DDD Lockdown 有効。BPM を ${this.cfg.threshold} 以上に上げないと入力できません。`;
      this.statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    }
  }

  // ───── ライフサイクル ─────

  private start(): void {
    if (this.active) {
      vscode.window.showInformationMessage("DDD Lockdown は既に有効です。");
      return;
    }

    // Vim 競合チェック
    if (this.cfg.skipIfVimDetected && isVimExtensionActive()) {
      vscode.window.showWarningMessage(
        "DDD Lockdown: Vim 拡張が有効です。type コマンドが競合するため自動で無効化されました。" +
          " 強制有効化するには ddd.lockdown.skipIfVimDetected を false にしてください。",
      );
      return;
    }

    try {
      this.typeDisposable = vscode.commands.registerCommand(
        "type",
        (args: TypeCommandArgs) => this.handleType(args),
      );
    } catch (err) {
      vscode.window.showErrorMessage(
        "DDD Lockdown: 'type' コマンドを登録できませんでした。他の拡張と競合しています。",
      );
      console.error("DDD Lockdown register type failed:", err);
      return;
    }

    if (this.cfg.blockPaste) {
      this.pasteListener = vscode.workspace.onDidChangeTextDocument((e) => this.handleChange(e));
    }

    this.active = true;
    vscode.window.showInformationMessage(
      `🔒 DDD Lockdown 有効 — ${this.cfg.threshold} bpm 以下では typing できません。緊急解除は ⌘+Alt+Escape`,
    );
  }

  private async stop(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    this.typeDisposable?.dispose();
    this.typeDisposable = null;
    this.pasteListener?.dispose();
    this.pasteListener = null;
    await this.releaseReadonly();
    // 通常モードに戻したことを通知
    vscode.window.showInformationMessage("🔓 DDD Lockdown を解除しました。");
  }

  private async toggle(): Promise<void> {
    if (this.active) {
      await this.stop();
    } else {
      this.start();
    }
  }

  /** どんな状態でも確実に解除する緊急口。設定の enabled は触らない。 */
  private async forceUnlock(): Promise<void> {
    if (this.active) {
      await this.stop();
    }
    vscode.window.showInformationMessage("🚨 DDD Lockdown: 緊急解除しました。");
  }

  // ───── type ハンドラ（主防御） ─────

  private async handleType(args: TypeCommandArgs): Promise<unknown> {
    if (this.canTypeNow()) {
      return vscode.commands.executeCommand("default:type", args);
    }
    // ブロック
    this.triggerFeedback();
    if (this.cfg.readonlyDefense) {
      this.applyReadonly().catch(() => {/* readonly 失敗は致命でないので静かに */});
    }
    return undefined;
  }

  private canTypeNow(): boolean {
    if (!this.active) return true;
    if (this.currentBpm >= this.cfg.threshold) return true;

    const editor = vscode.window.activeTextEditor;
    if (editor && !this.isLockdownTarget(editor.document)) return true;

    if (this.graceRemaining > 0) {
      this.graceRemaining--;
      return true;
    }
    return false;
  }

  private isLockdownTarget(doc: vscode.TextDocument): boolean {
    if (this.cfg.filePatterns.length === 0) return true;
    for (const pattern of this.cfg.filePatterns) {
      // vscode.languages.match は glob を解釈する DocumentSelector を受ける
      if (vscode.languages.match({ pattern }, doc) > 0) return true;
    }
    return false;
  }

  // ───── paste/cut の遮断（副防御） ─────

  private async handleChange(e: vscode.TextDocumentChangeEvent): Promise<void> {
    if (!this.active || this.canTypeNow()) return;
    if (!this.isLockdownTarget(e.document)) return;

    // type 経由の 1 文字入力は handleType で既にブロック済み。
    // ここで捕まえるべきは「複数文字が一度に挿入される変更」= paste / drag-drop / snippet。
    const looksLikePaste = e.contentChanges.some((c) => c.text.length > 1);
    if (!looksLikePaste) return;

    try {
      await vscode.commands.executeCommand("undo");
      this.triggerFeedback();
    } catch (err) {
      console.warn("DDD Lockdown: undo failed:", err);
    }
  }

  // ───── 視覚・音フィードバック ─────

  private triggerFeedback(): void {
    this.flashStatusBar();
    this.maybeShowToast();
    if (this.cfg.intensity === "intense") {
      this.shakeCursorLine();
    }
  }

  private flashStatusBar(): void {
    const deficit = Math.max(0, this.cfg.threshold - this.currentBpm);
    this.statusBar.text = `$(lock) LOCKED — 必要 +${deficit} bpm`;
    this.statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");

    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      // updateStatusBar が次の BPM で正しい表示に戻す
      this.updateStatusBar(this.currentBpm, false);
    }, FEEDBACK_FLASH_MS);
  }

  private maybeShowToast(): void {
    const now = Date.now();
    if (now - this.lastToastAt < TOAST_THROTTLE_MS) return;
    this.lastToastAt = now;
    const deficit = Math.max(0, this.cfg.threshold - this.currentBpm);
    vscode.window.showWarningMessage(
      `💢 LOCKDOWN: 情熱が足りません (現 ${this.currentBpm} bpm / 必要 ${this.cfg.threshold} bpm / 不足 +${deficit})`,
    );
  }

  private shakeCursorLine(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const line = editor.selection.active.line;
    const range = new vscode.Range(line, 0, line, 0);

    // border-left の幅を 4 フレームで切替えて疑似的に揺らす
    // （transform が decoration では効かないため、left-border の太さで代替）
    const frames: Array<{ width: string; color: string }> = [
      { width: "0 0 0 6px", color: "#ff3333" },
      { width: "0 0 0 2px", color: "#ff5500" },
      { width: "0 0 0 6px", color: "#ff3333" },
      { width: "0 0 0 1px", color: "#aa0000" },
    ];
    frames.forEach((f, i) => {
      setTimeout(() => {
        const deco = vscode.window.createTextEditorDecorationType({
          isWholeLine: true,
          backgroundColor: "rgba(255,0,0,0.28)",
          border: `${f.width} solid ${f.color}`,
        });
        editor.setDecorations(deco, [range]);
        setTimeout(() => deco.dispose(), 90);
      }, i * 50);
    });
  }

  // ───── ReadOnly Session（自前トラッキングで往復） ─────

  private async applyReadonly(): Promise<void> {
    if (this.myReadonlyApplied) return;
    try {
      await vscode.commands.executeCommand(
        "workbench.action.files.toggleActiveEditorReadonlyInSession",
      );
      this.myReadonlyApplied = true;
    } catch (err) {
      console.warn("DDD Lockdown: readonly toggle failed:", err);
    }
  }

  private async releaseReadonly(): Promise<void> {
    if (!this.myReadonlyApplied) return;
    try {
      await vscode.commands.executeCommand(
        "workbench.action.files.toggleActiveEditorReadonlyInSession",
      );
    } catch (err) {
      console.warn("DDD Lockdown: readonly release failed:", err);
    } finally {
      this.myReadonlyApplied = false;
    }
  }

  // ───── Config ─────

  private readConfig(): LockdownConfig {
    const c = vscode.workspace.getConfiguration(CONFIG_NS);
    return {
      enabled: c.get<boolean>("enabled") ?? false,
      threshold: c.get<number>("threshold") ?? 120,
      intensity: c.get<LockdownIntensity>("intensity") ?? "standard",
      graceCharacters: c.get<number>("graceCharacters") ?? 5,
      filePatterns:
        c.get<string[]>("filePatterns") ??
        ["**/*.{ts,tsx,js,jsx,go,py,rs,java,c,cpp,h,swift}"],
      blockPaste: c.get<boolean>("blockPaste") ?? true,
      readonlyDefense: c.get<boolean>("readonlyDefense") ?? false,
      skipIfVimDetected: c.get<boolean>("skipIfVimDetected") ?? true,
    };
  }
}

// ──────────────────────────────────────────────
// ヘルパー
// ──────────────────────────────────────────────

function isVimExtensionActive(): boolean {
  // VSCodeVim
  const vim = vscode.extensions.getExtension("vscodevim.vim");
  if (vim && vim.isActive) return true;
  // amVim
  const amVim = vscode.extensions.getExtension("auiworks.amvim");
  if (amVim && amVim.isActive) return true;
  // Awesome Emacs Keymap も type を触る可能性
  const emacs = vscode.extensions.getExtension("tuttieee.emacs-mcx");
  if (emacs && emacs.isActive) return true;
  return false;
}
