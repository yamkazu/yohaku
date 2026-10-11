# DynamoDB のキー設計

正本は `api/src/store.rs` の `article_item` / `ensure_schema` と、`infra/lib/yohaku-stack.ts` のテーブル定義。

## キー

| 属性 | 値の型 |
|---|---|
| `pk` | `ARTICLE#{id}` |
| `sk` | `META` |
| `entity` | `ARTICLE` |
| `gsi1pk` | `SLUG#{slug}` |
| `gsi1sk` | `ARTICLE` |

GSI 名は `gsi1`。slug での取得は Query（`DynamoStore::get_article_by_slug`）。一覧は今だけ Scan + `entity = ARTICLE` フィルタ（`DynamoStore::list_articles`）。**新しい Scan は足さない**（[banned.md](banned.md)）。一覧を Query に替えるのはキー設計の変更なので別 issue。

## Smoke canary

- 定数: `api/src/seed.rs` の `CANARY_SLUG`（`"deploy-smoke-canary"`）。
- 起動時に `seed_if_empty` が upsert する。サンプル記事とは別物。
- `GET /articles/{slug}` では読める。`GET /articles` と Web 一覧からは除く（`api/src/routes.rs` の `list_articles` が `CANARY_SLUG` で filter）。
- 固定テスト: `api/tests/http_ddb.rs` の `canary_is_readable_by_slug_but_hidden_from_the_list`。
