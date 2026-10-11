# ディレクトリの役割

コードを置く場所はここだけを見る。好みのレイアウトを増やさない。

| ディレクトリ | 役割 |
|---|---|
| `api/` | Rust + Axum の API。Lambda Web Adapter 向けバイナリと DynamoDB ストア。クレート根は `api/Cargo.toml`、HTTP 統合テストは `api/tests/`。 |
| `web/` | Vite + React + TypeScript の読みもの UI。`web/src/pages` が画面、`web/src/lib` が API クライアント。 |
| `infra/` | AWS CDK（TypeScript）。スタック定義は `infra/lib/yohaku-stack.ts`。デプロイは `main` の Deploy ワークフローだけ。 |
| `e2e/` | Playwright のユーザーハーネス。シナリオは `e2e/tests/`。本番 URL には当てない。 |
| `scripts/` | ローカル起動、`npm run verify`、CI ステップ本体（`scripts/ci/run.sh`）、デプロイスモーク。 |
| `docs/` | エージェントと人が読む運用メモ。機能地図は `docs/features.md`、デプロイ手順は `docs/deploy.md`。 |

`tools/` は DynamoDB Local など検証用の道具置き場。プロダクトの型を増やさない。
