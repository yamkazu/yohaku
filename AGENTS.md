# エージェント向け

## 必要な環境

必要な環境は README と同じ（Node.js 20+、Rust 1.94.1+、Java 17+）。

## 検証方法

コードを直したあとは `npm run verify` を実行してから「動いた」と判断する。

関係するステップだけ再実行するときは `npm run verify -- --only <step>` を使う。前提は自動で起動し、終わったら止まる。

機能の URL・ルートと、それを確かめるテストは `docs/features.md` を見る。

## コミットメッセージ

コミットは Conventional Commits に従う。

## 真似してよい型 / 書いてはいけない型

長くなった正本は `.cursor/rules/` にある。ここには入口だけ置く。

| 主題 | 正本 |
|---|---|
| ディレクトリの役割 | [`.cursor/rules/directories.md`](.cursor/rules/directories.md) |
| DynamoDB のキー設計 | [`.cursor/rules/dynamodb.md`](.cursor/rules/dynamodb.md) |
| エラー処理（`AppError`） | [`.cursor/rules/errors.md`](.cursor/rules/errors.md) |
| 禁止パターンと運用で踏んだこと | [`.cursor/rules/banned.md`](.cursor/rules/banned.md) |
| PR 本文の型 | [`.cursor/rules/pr-body.md`](.cursor/rules/pr-body.md) |

要約:

- 新しい store / ルートの失敗は `AppError` / `AppResult` に乗せる（`api/src/error.rs`、`api/src/store.rs`）。
- 記事キーは `pk` / `sk` / `gsi1pk` / `gsi1sk` と `entity`。canary は slug で読めて一覧には出さない。
- 禁止: 新しい Scan、lint を `#[allow]` / `#[expect]` で黙らせること、workaround コメント（直せないなら issue）、CI ジョブ名の変更、共有定数のコピペ。
- PR 本文は Why / What changed / Scope / Tradeoffs / Blast Radius / Verification。手本は [#33](https://github.com/yamkazu/yohaku/pull/33)。
