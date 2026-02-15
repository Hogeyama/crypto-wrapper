# cryptow プロファイル/CLI仕様

## 設定ファイル

- 既定: `~/.config/cryptow/profiles.yaml`
- 上書き: `XDG_CONFIG_HOME`, `CRYPTOW_CONFIG_DIR`

## プロファイル必須項目

- `command`（必須）: 文字列または配列
- `injectors`（必須）: 1件以上

## プロファイル任意項目

- `env`: 追加環境変数
- `working_dir` / `cwd`: 実行時カレントディレクトリ

## injector 仕様

### `type: gocryptfs`

- `password_entry`（必須）
- `cipher_dir`（任意）
  - 既定: `~/.local/share/cryptow/profiles/<profile>/cipher`
- `mount_dir`（任意）
  - 既定: `~/.local/share/cryptow/mounts/<profile>`

### `type: env`

- `password_entry`（必須）
- `env` / `variable` / `name`（必須）: 注入先変数名

## CLI

- `cryptow list [--json]`
- `cryptow init <profile> [--dry-run] [--gen-pass]`
- `cryptow mount <profile> [--dry-run]`
- `cryptow unmount <profile> [--dry-run]`
- `cryptow run <profile> [--dry-run] [--timeout <duration>] [-- <args...>]`

## run --timeout

- `--timeout <duration>` でコマンドの最大実行時間を指定できる。
- duration 形式は dax の `Delay` 型に準拠（`"30s"`, `"5m"`, `"1h30m"` など）。
- タイムアウト時の終了コードは **124**（GNU timeout と同じ慣習）。
- タイムアウト後もアンマウント・クリーンアップは正常に行われる。

## run 時の補助環境変数

- 自動設定されるのは `CRYPTOW_PROFILE` のみ。

## データ/ログ配置

- データ既定: `~/.local/share/cryptow`
- 上書き: `XDG_DATA_HOME`, `CRYPTOW_DATA_DIR`
- ログ: `~/.local/share/cryptow/log/cryptow.log`
