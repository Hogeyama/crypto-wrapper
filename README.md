# cryptow

## 概要
cryptow は `gocryptfs` と `pass` を組み合わせ、既存の CLI ツールを暗号化ストレージ越しに安全に利用するための Deno 製ラッパーです。プロファイル定義に従って暗号化ストアをマウントし、コマンド実行後に確実にアンマウントすることで秘匿情報の平文放置を防ぎます。

## 主な機能
- プロファイル単位で対象コマンド・環境変数・マウント設定を管理
- `gocryptfs` のマウント／アンマウントを自動化し、PID & ロックファイルで多重起動を防止
- `pass` からのパスワード取得による認証情報インジェクション
- `~/.local/share/cryptow/log/cryptow.log` への操作ログ保存（XDG 環境変数に追従）

## 必要条件
- Deno 1.45 以降（`deno --version` で確認）
- `gocryptfs` バイナリ（暗号化ディレクトリのマウントに使用）
- `pass`（`pass show` でシークレットを取得）
- `umount` が利用可能な Linux 環境を想定

## インストール
1. リポジトリを取得します。
   ```sh
   git clone https://github.com/Hogeyama/crypto-wrapper.git
   cd cryptow
   ```
2. Deno で実行ファイルをインストールします。
   ```sh
   deno install -A --name cryptow src/main.ts
   ```

開発中に直接実行する場合は `deno task dev` を利用できます。

## プロファイル設定
設定ファイルは既定で `~/.config/cryptow/profiles.yaml` に配置します（`XDG_CONFIG_HOME` や `CRYPTOW_CONFIG_DIR` を利用すると位置を変えられます）。

最小例:
```yaml
profiles:
  codex:
    command:
      - ~/.local/bin/codex
    injectors:
      - type: gocryptfs
        password_entry: gocryptfs/codex
        mount_dir: ~/.codex
      - type: env
        password_entry: openai_api_key
        env: OPENAI_API_KEY
```

各プロファイルは以下の項目を持ちます。
- `command`: 実行するバイナリと引数（文字列または配列）。`~` や環境変数は自動展開されます。
- `env`: 任意の環境変数上書きマップ。
- `injectors`: 少なくとも 1 つ以上のインジェクタを定義します。
  - `type: gocryptfs` は暗号化ストアをマウントします。`cipher_dir` と `mount_dir` を省略すると `~/.local/share/cryptow/profiles/<name>/cipher` と `~/.local/share/cryptow/mounts/<name>` が既定値になります。`password_entry` は `pass` 内のエントリ名です。
  - `type: env` は `pass` から取得したシークレットを環境変数に注入します。`env`（または `variable`/`name`）で変数名を指定します。
- `working_dir` / `cwd`: コマンド実行時のカレントディレクトリ。

データディレクトリは `~/.local/share/cryptow`（または `XDG_DATA_HOME`/`CRYPTOW_DATA_DIR`）配下に作成され、マウント用ディレクトリ・ロックファイル・ログを管理します。

## 使い方
- プロファイル一覧とマウント状態を確認:
  ```sh
  cryptow list
  cryptow list --json
  ```
- 暗号化ストアをマウントのみ実施:
  ```sh
  cryptow mount <profile> [--dry-run]
  ```
- マウント解除:
  ```sh
  cryptow unmount <profile> [--dry-run]
  ```
- マウントしてコマンドを実行後にアンマウント:
  ```sh
  cryptow run <profile> [--dry-run] [-- <追加引数>]
  ```
  実行時には `CRYPTOW_PROFILE`、`CRYPTOW_MOUNT`、`CRYPTOW_CIPHER` といった補助環境変数も自動的に設定されます。

`--dry-run` は実行予定のコマンドや環境変数上書きを出力するのみで実際のマウントやコマンド実行は行いません。

## ログ
操作ログは `~/.local/share/cryptow/log/cryptow.log`（XDG または `CRYPTOW_DATA_DIR` に従って解決）に追記されます。トラブルシュート時はこのファイルを確認してください。

## 開発・メンテナンス
- コードフォーマットと静的解析: `deno fmt` / `deno lint`
- 型チェック: `deno check src/main.ts`
- サンプル設定: `examples/profiles.yaml`

バグ報告や改善提案は Issue や Pull Request で歓迎します。
