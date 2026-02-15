# cryptow

このファイルは、作業開始前に必ず知るべき情報のみに限定する。
詳細仕様は `docs/` を参照すること。

## 0. まず確認
- 回答・コミットメッセージ・レビューコメントは日本語で行う。
- 仕様変更や実装判断の前に、以下 2 つを読む。
  - `docs/architecture.md`
  - `docs/profile-cli-spec.md`

## 1. 作業の基本方針
- 実装とドキュメントがずれていたら、同一PR/同一作業で一緒に更新する。
- 不明点がある場合は推測で仕様を増やさず、既存実装・テストを優先して判断する。

## 2. よく使うコマンド
- フォーマット/静的解析: `deno fmt && deno lint`
- 型チェック: `deno check src/main.ts`
- E2Eテスト: `deno test -A tests/e2e_*.ts`

## 3. ドキュメント配置
- アーキテクチャ・実行フロー: `docs/architecture.md`
- プロファイル/CLI仕様: `docs/profile-cli-spec.md`
