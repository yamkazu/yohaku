# エラー処理

一つの型だけを使う。新しい store 関数やルートもこれに合わせる。

## 型

- `AppError` / `AppResult` — `api/src/error.rs`
  - `AppError::NotFound` → HTTP 404、本文 `{"error":"not found"}`
  - `AppError::Other(_)` → HTTP 500、本文は常に `{"error":"internal error"}`（詳細は返さない）
- ルートは `AppResult` を返す（例: `api/src/routes.rs` の `get_article`）。

## Store からの変換

`api/src/store.rs` 先頭のモジュールコメントどおり:

- `SdkError` / `BuildError` / `chrono::ParseError` は `From` → `AppError`。呼び出し側は `?`。
- ラップの実体は private の `app_error_from`。手書きの `.map_err(|e| AppError::Other(e.into()))` を増やさない。
- このファイルで決めた失敗は `AppError::Other(anyhow::anyhow!(...))`。

## ログ

`AppError::Other` のログは構造化フィールドを保つ:

```rust
tracing::error!(error = %format_args!("{err:#}"), "internal error");
```

メッセージ文字列に詳細を埋め込まない。フィールド名 `error` にチェーンを載せる（`api/src/error.rs`）。
