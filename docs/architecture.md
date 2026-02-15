# cryptow アーキテクチャ

## 目的

`pass` で管理した秘密情報を使い、`gocryptfs` マウントを介して既存 CLI を安全に実行する。

## 構成要素

- `src/main.ts`: CLI エントリポイント（`list/init/mount/unmount/run`）
- `src/profile.ts`: `profiles.yaml` の読み込みとバリデーション
- `src/mount.ts`: 初期化・マウント・アンマウント・マウント状態判定
- `src/pass.ts`: `pass show` でシークレット取得
- `src/logger.ts`: 操作ログ出力
- `src/paths.ts`: XDG/環境変数に基づくパス解決

## 実行フロー（run）

1. プロファイルを読み込み、`command` / `env` / `injectors` / `working_dir` を解決。
2. `gocryptfs` injector のマウントポイントがアクティブか確認。
3. 未マウントなら `mountProfile` 実行、既マウントなら再利用。
4. `env` injector ごとに `pass show` で値を取得し、環境変数へ注入。
5. 対象コマンドを実行し、終了コードを返却。
6. `run` が自分でマウントした場合のみアンマウント。

## マウント状態管理

- 判定は `/proc/self/mountinfo` を優先し、失敗時は `mountpoint -q` にフォールバック。
- 状態ファイルは `~/.local/share/cryptow/profiles/<profile>/mount.pid`。
- ロックファイル・リファレンスカウントは未採用。

## 認証情報と初期化

- シークレット取得元は `pass` のみ。
- `init` は `gocryptfs` injector を対象に `gocryptfs -init` を実行。
- `init --gen-pass` は `pass generate <entry> 32` を先行実行。
- 既存 `gocryptfs.conf` または既存 pass エントリがある場合は安全のため失敗させる。

## ログ

- `~/.local/share/cryptow/log/cryptow.log` に追記。
- 標準出力とログファイルは分離。
