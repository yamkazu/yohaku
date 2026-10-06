# エージェント向け

## 必要な環境

必要な環境は README と同じ（Node.js 20+、Rust 1.94.1+、Java 17+）。

## 検証方法

コードを直したあとは `npm run verify` を実行してから「動いた」と判断する。

## コミットメッセージ

エージェントと開発者が従う規約。linter は使わない。

件名は `type: subject`。type は小文字。subject は命令形。末尾にピリオドは付けない。範囲が要るときは `type(scope): subject`。

- `feat` は機能を足す。
- `fix` は不具合を直す。
- `docs` は文書を変える。
- `ci` は CI を変える。
- `test` はテストを変える。
- `refactor` は振る舞いを変えずに構造を変える。
