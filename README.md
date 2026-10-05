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

ローカルの一覧と詳細を、CloudFront の 1 つの URL で公開する。ブラウザは `/api/articles` を呼び、CloudFront が `/api` を外してから Lambda に渡す。Axum の経路は `/articles` のまま。記事ページ `/articles/:slug` は静的ファイルのまま。リージョンは `ap-northeast-1`、スタック名は `Yohaku`。

プルリクエストは `cdk synth` までです。AWS は変わりません。`main` への push だけがスタックを作るか更新します。デプロイは同時に一つだけです。進行中のデプロイは中断しません。

一度きりの準備は次の 3 つです。コマンドは [docs/deploy.md](docs/deploy.md) にあります。

1. CDK の bootstrap（アカウントと `ap-northeast-1` の組。ワークフローでは実行しない）
2. GitHub Actions が引き受ける IAM ロール（OpenID Connect の短期セッション）
3. リポジトリ変数 `AWS_ROLE_ARN` にそのロールの ARN を入れる

AWS のアクセスキーはリポジトリにも GitHub Secrets にも置きません。スタックを削除しても DynamoDB のテーブルは残ります（`RemovalPolicy.RETAIN`）。

## 次のスライス（未実装）

- 著者・タグ
- 認証・投稿
- デプロイ後の smoke チェック
