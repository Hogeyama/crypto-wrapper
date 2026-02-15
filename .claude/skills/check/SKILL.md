---
name: check
description: MUST run this skill after completing any code edits. Runs fmt, lint, type-check, and tests.
---

## Check

コード変更後に fmt, lint, type-check, test を順に実行し、結果を報告する。

### 手順

1. `deno fmt` を実行する。差分があれば何が修正されたか報告する。
2. `deno lint` を実行する。警告やエラーがあれば報告する。
3. `deno check src/main.ts` を実行する。型エラーがあれば報告する。
4. `deno test -A` を実行する。失敗があれば報告する。

### 報告

全ステップ完了後、結果を以下の形式で簡潔にまとめる:

- fmt: OK / 修正あり (ファイル名)
- lint: OK / エラーあり (件数)
- check: OK / エラーあり (件数)
- test: OK / 失敗あり (件数) / スキップ
