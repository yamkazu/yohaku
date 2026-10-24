# エージェント向け

## 必要な環境

必要な環境は README と同じ（Node.js 20+、Rust 1.94.1+、Java 17+）。

## 検証方法

コードを直したあとは `npm run verify` を実行してから「動いた」と判断する。

関係するステップだけ再実行するときは `npm run verify -- --only <step>` を使う。前提は自動で起動し、終わったら止まる。

機能の URL・ルートと、それを確かめるテストは `docs/features.md` を見る。

## コミットメッセージ

コミットは Conventional Commits に従う。

## レビュー

レビューの観点は `REVIEW.md` を見る。
