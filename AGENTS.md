# エージェント向け

コードを直したあとは、次を実行してから「動いた」と判断する。必要な環境は README と同じ（Node.js 20+、Rust 1.94.1+、Java 17+）。

```bash
npm run verify
```

CI の Web / API / E2E と同じコマンド（`scripts/ci/run.sh`）を順に実行する。中身は Web の依存関係インストール、lint、build、DynamoDB Local の起動、API の `cargo fmt` / `clippy` / `build` / `cargo test --locked --features integration`、API の起動、Playwright の既存ジャーニー（一覧から記事を開く。`e2e/tests/feed-to-article.spec.ts`）である。DynamoDB Local と API はこのコマンドが起動し、成功しても失敗しても止める。

ステップ名は `web-install`、`web-lint`、`web-build`、`dynamodb`、`api-fmt`、`api-clippy`、`api-build`、`api-test`、`api-start`、`e2e-install`、`playwright-install`、`e2e`。

- 終了コード 0: 通った。`.verify/summary.json` は `ok: true`
- 終了コード 0 以外: 同じ JSON の `failedStep` が落ちたステップ、`logTail` がそのログの末尾。全文は `failedLog`（`.verify/<step>.log`）。Playwright が落ちたときはスクリーンショットとトレースが `.verify/playwright/` にある。API プロセスのログは `.verify/api-server.log`

`.verify/` は git に入れない。本番への smoke はここでは見ない。
