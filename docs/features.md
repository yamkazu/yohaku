# 機能の地図

今ある機能と、そこへ行く経路、期待する応答、それを確かめるテスト。ローカルの既定ポートは Web が `http://127.0.0.1:3847`、API が `http://127.0.0.1:3848`。

各行は、実在するルートと、その振る舞いを固定しているテストを指す。

| 機能 | たどり方 | 期待する応答 | テスト |
|---|---|---|---|
| health | `GET /health` | `200`。`status` は `ok`、`service` は `yohaku-api`、`store` は `dynamodb` | `api/tests/http_ddb.rs` の `health_ok` |
| 記事一覧（canary を出さない） | Web `/`。見出し「余白」。各記事はタイトルのリンク | シードした記事が見える。文言 `Deploy smoke canary` は出ない | `e2e/tests/feed-to-article.spec.ts` の `home lists seeded articles and opens article detail` |
| 記事一覧（canary を出さない） | `GET /articles` | `200` の配列。slug `deploy-smoke-canary` を含まない。`whitespace-as-product-design` を含む | `api/tests/http_ddb.rs` の `list_articles_returns_seeded_rows` と `canary_is_readable_by_slug_but_hidden_from_the_list` |
| 記事詳細 | Web `/articles/whitespace-as-product-design`。一覧のタイトルのリンクから開く | URL が `/articles/whitespace-as-product-design`。見出しが記事タイトル。本文に「視線の導線」 | `e2e/tests/feed-to-article.spec.ts` の `home lists seeded articles and opens article detail` |
| 記事詳細 | `GET /articles/{slug}`。例は `GET /articles/quiet-apis` | `200`。`slug` は `quiet-apis`。`title` と `body` がある。`cover_tone` は無い | `api/tests/http_ddb.rs` の `get_known_slug_returns_article` |
| 存在しない slug | Web `/articles/does-not-exist-slug` | 「記事が見つかりませんでした。」と、リンク「フィードに戻る」 | `e2e/tests/feed-to-article.spec.ts` の `unknown slug shows not-found state` |
| 存在しない slug | `GET /articles/{slug}`。例は `GET /articles/does-not-exist-slug` | `404`。`{"error":"not found"}` | `api/tests/http_ddb.rs` の `unknown_slug_returns_404` |

`npm run verify` または `npm run verify -- --only e2e` が成功したあと、画面の証拠が `.verify/screenshots/` に残る。

- `article-list.png` — 記事一覧
- `article-detail.png` — 記事詳細
- `not-found.png` — 存在しない slug
