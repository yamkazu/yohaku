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

デプロイ用のビルドには、ローカル開発の環境に加えて次が必要です。

- [cargo-lambda](https://www.cargo-lambda.info/guide/installation.html)
- zig（`PATH` に入っていること。cargo-lambda が glibc 2.34 向けにクロスコンパイルする）

プルリクエストはテンプレートの合成までです。AWS は変わりません。

```bash
npm ci --prefix web
npm ci --prefix infra
npm run build:web:deploy
npm run build:lambda
npm run synth
```

`npm run synth` がテンプレートを出せば、アカウントがなくても構成は確認できる。

ブートストラップは、アカウントと `ap-northeast-1` の組で一度だけ実行する。ワークフローでは実行しない。

```bash
npm --prefix infra run bootstrap -- aws://<account-id>/ap-northeast-1
```

同じアカウントで、GitHub Actions が引き受ける IAM ロールを一度だけ作る。認証は OpenID Connect の短期セッションです。ロールの ARN はリポジトリ変数 `AWS_ROLE_ARN` に入れる。AWS のアクセスキーはリポジトリにも GitHub Secrets にも置かない。

OIDC プロバイダがまだ無ければ、URL `https://token.actions.githubusercontent.com`、audience `sts.amazonaws.com` で作る。プロバイダはアカウントに一つ。

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

信頼する `sub` は、このリポジトリの main だけです。

`repo:yamkazu@231908/yohaku@1389283340:ref:refs/heads/main`

```bash
aws iam create-role \
  --role-name yohaku-github-deploy \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": {
          "Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com"
        },
        "Action": "sts:AssumeRoleWithWebIdentity",
        "Condition": {
          "StringEquals": {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub": "repo:yamkazu@231908/yohaku@1389283340:ref:refs/heads/main"
          }
        }
      }
    ]
  }'

aws iam put-role-policy \
  --role-name yohaku-github-deploy \
  --policy-name yohaku-cdk-deploy \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": "sts:AssumeRole",
        "Resource": [
          "arn:aws:iam::<account-id>:role/cdk-hnb659fds-deploy-role-<account-id>-ap-northeast-1",
          "arn:aws:iam::<account-id>:role/cdk-hnb659fds-file-publishing-role-<account-id>-ap-northeast-1",
          "arn:aws:iam::<account-id>:role/cdk-hnb659fds-image-publishing-role-<account-id>-ap-northeast-1",
          "arn:aws:iam::<account-id>:role/cdk-hnb659fds-lookup-role-<account-id>-ap-northeast-1"
        ]
      },
      {
        "Effect": "Allow",
        "Action": "ssm:GetParameter",
        "Resource": "arn:aws:ssm:ap-northeast-1:<account-id>:parameter/cdk-bootstrap/hnb659fds/version"
      }
    ]
  }'

gh variable set AWS_ROLE_ARN --repo yamkazu/yohaku \
  --body "arn:aws:iam::<account-id>:role/yohaku-github-deploy"
```

この準備には、操作する人の AWS 認証情報が要る。デプロイのたびに繰り返さない。

main への push だけが `npm --prefix infra run deploy` を実行し、スタックを作るか更新する。デプロイは同時に一つだけ。進行中のデプロイは中断しない。

スタックを削除しても DynamoDB のテーブルは残る。

初回の API 起動は、テーブルが空ならサンプル記事を 3 件書く。テーブル名は CDK が決める。関数の `YOHAKU_TABLE` にその名前が入る。

`npm run dev:web` と `npm run test:e2e` はこれまでどおり。デプロイ用ビルドだけ `VITE_API_URL=/api` を使う。slug に `.` が含まれると、再読み込みは静的ファイルの要求になり、`index.html` には戻らない。今のサンプル記事の slug には `.` はない。

## 次のスライス（未実装）

- 著者・タグ
- 認証・投稿
- デプロイ後の smoke チェック
