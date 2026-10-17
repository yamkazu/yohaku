# CI ステップ名

GitHub Actions の CI（`.github/workflows/ci.yml`）で `scripts/ci/run.sh` を呼ぶステップの `name:` は、`run.sh` のステップ名と 1 対 1 で揃える（例: `web-lint`、`api-test`、`e2e`）。セットアップ系（`actions/checkout` など）はこの対応の外。

失敗時は各ジョブが `.ci/summary.json`（形は `.verify/summary.json` と同じ）とステップログを artifact `ci-failure-<job>` に残す。`.ci/` は hidden path なので upload に `include-hidden-files: true` が要る。outer loop は artifact の `failedStep` / `exitCode` / `logTail` を読む。

**ステップ名を変えるときは、outer-loop の失敗解釈ルーティンも同時に直す。** コメントやドキュメントだけの更新では不十分。名前の正本は `scripts/ci/run.sh` の `case` と workflow の `name:`。
