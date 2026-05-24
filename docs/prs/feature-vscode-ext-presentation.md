# PR Draft — `feature/vscode-ext-presentation`

ブランチ: `feature/vscode-ext-presentation`（base: `main`）
作成日: 2026-05-23
計画書: `docs/plans/vscode-ext-presentation-upgrade.md`

---

## 📝 コミットメッセージ

```
feat(vscode-ext): コミット演出を3段構え化・Tier化・全画面化・コード一時挿入

「パッと出て終わるだけでインパクト不足」だった既存演出を、予告→主演出→
余韻の 3 フェーズ構成に再設計し、BPM 帯ごとの段階化と全画面占有モード、
そして REJECTED 時のエディタへのダメージコメント挿入まで実装する。

実装方針: docs/plans/vscode-ext-presentation-upgrade.md

## Phase 1（基礎強化）
- Buildup フェーズ: 鼓動パルス × 3 → 白フラッシュ → 主演出 (1.9s)
- 多段サウンド: Tink → Tink → Pop → Hero の 4 連
- パネル最大化: ViewColumn.Active で現在フォーカスエリアを占有
- Tier 1-5 段階化: BPM 120/140/160/180/200 で背景色・称号・粒子数が変化
  Tier 1 ACCEPTED / 2 PASSIONATE / 3 INTENSE / 4 LEGENDARY / 5 心臓破り
- ステータスバー余韻: コミット後 3 秒間 "PASSION!" / "REJECTED" を点滅

## Phase 2（演出多層化）
- エディタ行装飾: カーソル行を炎色に、行末に "🔥 PASSION +bpm" を表示 (5s)
  rejected 時はグレー + "💔 REJECTED at N bpm"
- コンボカウンタ: globalState 永続化、3x/5x/10x で異なるバッジ表示
- 自己ベスト追跡: 起動時にステータスバーで過去ベスト表示
- トースト連射: 主演出と並行して通知エリアに +bpm / ランク / コンボを順次表示

## Phase 3（フル没入）
- 全画面モード: Tier 4+ でサイドバー / 下部パネルを一時的に閉じ、
  メインパネルと Achievement Card を並列表示。dispose で自動復元
- Achievement Card: RPG 風の称号アンロックパネル
  Rarity (EPIC/LEGENDARY/MYTHIC) + 統計 + バッジ + 光輪パルス
- グリッチ強化（rejected）:
  - SVG turbulence ノイズオーバーレイ
  - CRT スキャンライン
  - 画面ヒビ（12 本の SVG ライン放射）
- ダメージコメント一時挿入（rejected）:
  「💀 REJECTED at N bpm — passion deficit: +M」を 3 秒だけカーソル行に挿入
  言語別コメント構文対応 (// # <!-- --> /* */)
  安全弁 4 重: 設定 OFF / activeEditor 無し / dirty / 3 秒後の正確マッチ

## 設定（package.json contributes.configuration）
全演出は VS Code 設定から OFF 可能:
- ddd.presentation.intensity (calm/normal/intense)
- ddd.presentation.flashEnabled / soundEnabled
- ddd.presentation.editorDecorations / comboTracking
- ddd.presentation.fullScreenMode / codeInjection

## ビルド修正
既存 compile スクリプトに `--external vscode` を追加。これがないと
"Could not resolve: vscode" でビルドエラーになる既存バグを修正。

## 検証
- tsc --noEmit パス
- bun run compile → dist/extension.js 36.55 KB
- 拡張サイズ: 25.37 KB → 36.55 KB (約 1.4 倍)
- 行数: 170 → 約 780 行

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## 📋 PR タイトル

```
feat(vscode-ext): コミット演出のインパクト大幅強化(Phase 1+2+3)
```

---

## 📋 PR 本文

```markdown
## 概要

「git commit 時の VS Code 拡張演出が、パッと出てパッと消えるだけでインパクト不足」という課題を、**演出を 3 フェーズ構成に再設計し、BPM 帯ごとの段階化と全画面占有モード、ダメージコメント挿入まで実装**して解決する。

実装計画書: `docs/plans/vscode-ext-presentation-upgrade.md`

## 何が変わったか — 一目で分かる比較

| 観点 | Before | After |
|---|---|---|
| 演出構成 | 主演出のみの 1 フェーズ | 予告 → 主演出 → 余韻の 3 フェーズ |
| BPM 段階 | 一律「ACCEPTED」 | Tier 1〜5（ACCEPTED / PASSIONATE / INTENSE / **LEGENDARY** / **心臓破り**） |
| 画面占有 | パネル 1 枚 | Tier 4+ でサイドバー閉じ + 2 パネル並列 |
| 効果音 | システム音 1 発 | 4 連鎖（鼓動 → 鼓動 → ポップ → 主音） |
| 余韻 | なし | ステータスバー 3 秒点滅 |
| エディタへの波及 | なし | 行ハイライト + ガッタ印 + 行末メッセージ |
| 継続性 | なし | コンボカウンタ + 自己ベスト追跡 |
| 拒否時 | 静止画 | グリッチ + スキャンライン + 画面ヒビ + コードへ一時挿入 |

## 実装した演出（accepted 時の時系列）

```
0ms       コミット情報を WS で受信
0-1900ms  ━━ Buildup ━━
          鼓動パルス × 3 + 多段効果音 + 1550ms に白フラッシュ
1900ms-   ━━ Main ━━
          Tier ラベル / 巨大 BPM / 火の粉粒子 (Tier 連動 25-80 個)
          コンボバッジ / NEW PB バッジ
1200ms-   ━━ Toast Burst ━━
          +bpm → ランク → コンボ/ベストを順次通知
0-3000ms  ━━ Status Bar Afterglow ━━
          "PASSION!" ↔ "..." を 200ms 間隔で点滅
0-5000ms  ━━ Editor Decoration ━━
          カーソル行を炎色 + overview ruler + "🔥 PASSION +bpm"
Tier 4+   ━━ Full Screen Mode (Phase 3-I) ━━
          サイドバー閉じ + Achievement Card を Beside に並列開き
7-12s     ━━ Auto Close ━━ Tier に応じて 7/9/12 秒
```

## Tier 段階表

| Tier | BPM | ラベル | 称号 | 演出特徴 |
|:-:|:-:|---|---|---|
| 1 | 120-139 | ACCEPTED | 🔥 ACCEPTED | 標準 |
| 2 | 140-159 | PASSIONATE | 🔥 PASSIONATE | 粒子数増 |
| 3 | 160-179 | INTENSE | ⚡ INTENSE | 背景色濃化 |
| 4 | 180-199 | **LEGENDARY** | 👑 LEGENDARY | + 全画面モード + Achievement Card |
| 5 | 200+ | **心臓破り** | 💀 LIFE THREATENING | + 「医療従事者を呼んでください」 |

## REJECTED 時の演出

```
0-400ms    フリーズ（グレースケール + ぼかし）
400-1600ms グリッチ（RGB 分離 + SVG turbulence ノイズ + スキャンライン）
900ms-     画面ヒビ（12 本の SVG line 放射）
1600ms-    主演出（💔 シェイク / 統計 3 ボックス / サジェスト 5 項目）
+ 3 秒間  カーソル行にダメージコメント一時挿入（言語別構文対応）
+ intense 時に 1.2 秒の画面振動
~14s       自動クローズ
```

## 安全装置（ダメージコメント挿入）

ユーザーの作業を絶対に壊さないよう 4 重のガード:

1. **設定で OFF 可能** (`ddd.presentation.codeInjection: false`)
2. **`activeTextEditor` が無ければスキップ**
3. **`document.isDirty` が true ならスキップ**（未保存変更を絶対に触らない）
4. **3 秒後の削除前にテキスト一致確認** — ユーザーがその行を編集していたら削除しない

## 追加された設定（VS Code 設定 UI から変更可能）

| キー | 既定 | 説明 |
|---|---|---|
| `ddd.presentation.intensity` | `normal` | `calm` / `normal` / `intense` |
| `ddd.presentation.flashEnabled` | `true` | 予告フラッシュ（てんかん配慮） |
| `ddd.presentation.soundEnabled` | `true` | 効果音 |
| `ddd.presentation.editorDecorations` | `true` | エディタ行ハイライト |
| `ddd.presentation.comboTracking` | `true` | コンボカウンタ |
| `ddd.presentation.fullScreenMode` | `true` | Tier 4+ で全画面 + Achievement Card |
| `ddd.presentation.codeInjection` | `true` | REJECTED 時のコード一時挿入 |

## ファイル変更

- **MOD** `vscode-ext/src/extension.ts` (170 → 約 780 行)
  - Tier 判定とアセット定義
  - 多段サウンド再生
  - 全画面モード ヘルパー(`enterFullScreenMode` / `exitFullScreenMode`)
  - ダメージコメント挿入 ヘルパー(言語別構文)
  - Achievement Card HTML 生成
  - 拒否 HTML 強化(SVG noise / scanlines / crack)
  - エディタ行装飾、コンボ管理、トースト連射、ステータスバー余韻
- **MOD** `vscode-ext/package.json`
  - `contributes.configuration` に 7 設定追加
  - **既存ビルドバグ修正**: `compile` スクリプトに `--external vscode` 追加
- **MOD** `vscode-ext/bun.lock` — `bun install` の差分

## 検証

**自動**
- [x] `tsc --noEmit` パス
- [x] `bun run compile` → `dist/extension.js` 36.55 KB(25.37 KB から 1.4 倍)

**手動**
```bash
cd vscode-ext && bun run compile
# F5 で Extension Development Host を起動
mise run daemon:run

# Tier 4 LEGENDARY(全画面 + Achievement Card 並列)
curl -X POST http://localhost:8765/commits \
  -H "Content-Type: application/json" \
  -d '{"repo_path":"/tmp/test","commit_hash":"abc","bpm":188,"result":"accepted"}'

# Tier 5 心臓破り
curl -X POST http://localhost:8765/commits \
  -H "Content-Type: application/json" \
  -d '{"repo_path":"/tmp/test","commit_hash":"abc","bpm":210,"result":"accepted"}'

# REJECTED + ダメージコメント挿入(事前に何かファイルを開いておく)
curl -X POST http://localhost:8765/commits \
  -H "Content-Type: application/json" \
  -d '{"repo_path":"/tmp/test","commit_hash":"","bpm":95,"result":"rejected"}'
```

## スコープ外(次回以降)

- **Phase 2-G**: カスタム音源バンドル(mp3 同梱)— バイナリ追加が必要
- **Phase 3-L**: Achievement システム拡張(20 個の称号 + 永続的アンロック画面)
- **Phase 3-M**: BPM 連動 BGM — 音源バンドル前提

## アクセシビリティ・行儀

- すべての演出は設定で OFF 可能
- フラッシュは `flashEnabled: false` で完全に無効化可(てんかん配慮)
- 全画面モードはパネル dispose 時 / 手動クローズ時に必ずサイドバー復元
- ダメージコメント挿入は dirty ドキュメントには触らない設計

## 関連

- 計画書: `docs/plans/vscode-ext-presentation-upgrade.md`
- 関連 Issue: #72 [V-1] VS Code拡張: F-03 BPM閾値未満でエディタ入力を制限(本 PR は補完的演出機能)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
