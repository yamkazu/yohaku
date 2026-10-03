# 余白（Yohaku）

note の静けさに寄せた、技術記事の読みもの。第1スライスは **記事一覧と記事詳細** のみ。

## スタック

| 層 | 技術 |
|---|---|
| Web | Vite + React + TypeScript + Tailwind |
| API | Rust + Axum（Lambda Web Adapter） |
| DB | DynamoDB（ローカルは DynamoDB Local） |

## 必要環境

- Node.js 20+
- Rust **1.94.1+**（リポジトリ直下の `rust-toolchain.toml` で固定）
- Java 17+（DynamoDB Local 用）

## 起動

別ターミナルで順に:

```bash
# 1. DynamoDB Local (:8000)
npm run dev:ddb

# 2. API (:3848)
npm run dev:api

# 3. Web (:3847)
npm run dev:web
```

ブラウザ: http://127.0.0.1:3847

API 例:

```bash
curl http://127.0.0.1:3848/health
curl http://127.0.0.1:3848/articles
curl http://127.0.0.1:3848/articles/whitespace-as-product-design
```

## 環境変数（API）

| 変数 | 既定 |
|---|---|
| `PORT` | `3848` |
| `DYNAMODB_ENDPOINT` | 未設定時は AWS 既定エンドポイント（`npm run dev:api` は Local 用に `http://127.0.0.1:8000` をセット） |
| `AWS_ENDPOINT_URL_DYNAMODB` | `DYNAMODB_ENDPOINT` の代替（明示時のみ使用） |
| `YOHAKU_TABLE` | `yohaku` |
| `AWS_REGION` | `us-east-1` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Local 用に `local` |

Web は `VITE_API_URL`（既定 `http://127.0.0.1:3848`）。

## デプロイ

ローカルの一覧と詳細を、CloudFront の 1 つの URL で公開する。ブラウザは `/api/articles` を呼び、CloudFront が `/api` を外してから Lambda に渡す。Axum の経路は `/articles` のまま。記事ページ `/articles/:slug` は静的ファイルのまま。

デプロイには、ローカル開発の環境に加えて次が必要です。

- [cargo-lambda](https://www.cargo-lambda.info/guide/installation.html)
- zig（`PATH` に入っていること。cargo-lambda が glibc 2.34 向けにクロスコンパイルする）
- AWS 認証情報（`cdk deploy` のときだけ。`cdk synth` には不要）

```bash
npm ci --prefix web
npm ci --prefix infra
npm run build:web:deploy
npm run build:lambda
npm run synth
```

`npm run synth` がテンプレートを出せば、アカウントがなくても構成は確認できる。アカウントがあるときは、リージョンごとに 1 回 `npm --prefix infra run bootstrap` を実行してから `npm --prefix infra run deploy` を実行する。出力の `SiteUrl` を開く。

初回の API 起動は、テーブルが空ならサンプル記事を 3 件書く。テーブル名は CDK が決める。関数の `YOHAKU_TABLE` にその名前が入る。

`npm run dev:web` と `npm run test:e2e` はこれまでどおり。デプロイ用ビルドだけ `VITE_API_URL=/api` を使う。slug に `.` が含まれると、再読み込みは静的ファイルの要求になり、`index.html` には戻らない。今のサンプル記事の slug には `.` はない。

## 次のスライス（未実装）

- 著者・タグ
- 認証・投稿
- デプロイ後の smoke チェック
