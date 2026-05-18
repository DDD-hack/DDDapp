# DDD

[![Daemon CI](https://github.com/DDD-hack/DDDapp/actions/workflows/daemon-ci.yml/badge.svg)](https://github.com/DDD-hack/DDDapp/actions/workflows/daemon-ci.yml)
[![Hooks CI](https://github.com/DDD-hack/DDDapp/actions/workflows/hooks-ci.yml/badge.svg)](https://github.com/DDD-hack/DDDapp/actions/workflows/hooks-ci.yml)

## 環境構築

### 前提条件

- [mise](https://mise.jdx.dev/) がインストール済みであること
- [Homebrew](https://brew.sh/) がインストール済みであること
- `gh` CLI が Homebrew でインストール済みであること (`brew install gh`)

> **Go / Node.js / Bun / Firebase CLI は個別インストール不要です。**
> `mise install` を実行すると mise が自動でダウンロード・管理します。
>
> **注意:** `gh` のみ例外で、mise ではなく Homebrew で管理します（mise の attestation 検証が不安定なため）。

---

### 1. mise のインストール

まだ mise をインストールしていない場合:

```bash
curl https://mise.run | sh
```

シェルに mise を有効化する設定を追加します（初回のみ）:

```bash
# zsh の場合
echo 'eval "$(mise activate zsh)"' >> ~/.zshrc
source ~/.zshrc

# bash の場合
echo 'eval "$(mise activate bash)"' >> ~/.bashrc
source ~/.bashrc
```

### 2. ツールのインストール

リポジトリルートで以下を実行します。`mise.toml` に定義されたツール（Go / Node.js / Bun / Firebase CLI）が一括インストールされます:

```bash
mise install
```

インストールされるバージョン:

| ツール    | バージョン |
|-----------|-----------|
| Go        | 1.25.6    |
| Node.js   | 24.2.0    |
| Bun       | latest    |
| Firebase CLI | 15.15.0 |

### 3. 環境変数の設定

`.env.example` をコピーして `.env` を作成し、各値を埋めます:

```bash
cp .env.example .env
```

```env
# Firebase (dashboard)
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

`mise.toml` の `[env]` セクションにより、`mise` 経由でコマンドを実行すると `.env` が自動的に読み込まれます。また以下の変数もデフォルト値として設定されます:

| 変数                  | デフォルト値 | 説明                     |
|-----------------------|-------------|--------------------------|
| `DDD_DAEMON_PORT`     | `8765`      | デーモンの待受ポート     |
| `DDD_THRESHOLD_BPM`   | `120`       | BPM のしきい値           |

#### 閾値の個人設定（~/.ddddrc）

環境変数の代わりに `~/.ddddrc` ファイルで閾値を永続設定できます:

```toml
# ~/.ddddrc
threshold_bpm = 100
```

優先順位: **環境変数 `DDD_THRESHOLD_BPM` > `~/.ddddrc` > デフォルト 120**

ファイルが存在しない場合はデフォルト値が使われます。

### 4. 依存パッケージのインストール

dashboard と VS Code 拡張の依存パッケージをインストールします:

```bash
cd dashboard && bun install
cd ../vscode-ext && bun install
```

### 5. Git hooks のインストール

`ddd-hook` バイナリ（`dddd` とは独立した Go 製バイナリ）が `.git/hooks/pre-commit` へのラッパースクリプトを自動生成します。

```bash
# まず daemon をビルドして dddd を PATH に通す
mise run daemon:build
export PATH="$PWD/bin:$PATH"

# hook をインストール
mise run hooks:install
```

> **Daemon 未起動時の挙動:** Daemon がクラッシュ・未起動の場合でも commit はブロックされません（警告表示のみ）。ツール障害で開発が止まらないよう fail-open ポリシーを採用しています。

---

## Windows での使用

Git for Windows（Git Bash）または WSL をインストールしてください。
Git for Windows をインストールすると Git Bash が自動でついてきます。

- [Git for Windows](https://gitforwindows.org/)
- [WSL セットアップガイド](https://learn.microsoft.com/ja-jp/windows/wsl/install)

> **注意:** PowerShell / コマンドプロンプトでは pre-commit hook（Bash スクリプト）が動きません。Git Bash または WSL 上で git コマンドを実行してください。

---

## タスク一覧

mise のタスク機能でプロジェクト操作を統一管理しています。`mise run <タスク名>` で実行できます。

### Daemon (Go)

```bash
mise run daemon:run      # デーモンを起動
mise run daemon:build    # バイナリをビルド → bin/ddd
mise run daemon:fmt      # コードをフォーマット
mise run daemon:lint     # 静的解析 (go vet)
mise run daemon:test     # テストを実行
```

### Dashboard (Next.js)

```bash
mise run dashboard:run     # 開発サーバを起動
mise run dashboard:build   # プロダクションビルド
mise run dashboard:lint    # 静的解析
mise run dashboard:fmt     # コードをフォーマット
mise run dashboard:deploy  # Vercel にデプロイ
```

### VS Code 拡張

```bash
mise run vscode-ext:build    # ビルド
mise run vscode-ext:watch    # ウォッチモードでビルド
mise run vscode-ext:package  # .vsix にパッケージ
mise run vscode-ext:lint     # 静的解析
```

### Git hooks

```bash
mise run hooks:install    # ddd-hook による pre-commit hook をインストール (dddd install-hook)
mise run hooks:uninstall  # pre-commit hook をアンインストール (dddd uninstall-hook)
```

タスク一覧を確認したい場合:

```bash
mise tasks
```
