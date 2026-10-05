# デプロイ

README の「デプロイ」は公開の形と、いつ AWS が変わるかだけを書いています。ここには、ローカルでの合成と、一度きりの準備のコマンドを置きます。

公開先は CloudFront の 1 つの URL です。ブラウザは `/api/articles` を呼び、CloudFront が `/api` を外してから Lambda に渡します。Axum の経路は `/articles` のままです。記事ページ `/articles/:slug` は静的ファイルのままです。リージョンは `ap-northeast-1`、スタック名は `Yohaku` です。

プルリクエストは `cdk synth` までです。AWS は変わりません。`main` への push だけが `npm --prefix infra run deploy` を実行し、スタックを作るか更新します。デプロイは同時に一つだけです。進行中のデプロイは中断しません。ワークフローは bootstrap を実行しません。

## ローカルでテンプレートを合成する

ローカル開発の環境に加えて、次が必要です。

- [cargo-lambda](https://www.cargo-lambda.info/guide/installation.html)
- zig（`PATH` に入っていること。cargo-lambda が glibc 2.34 向けにクロスコンパイルする）

```bash
npm ci --prefix web
npm ci --prefix infra
npm run build:web:deploy
npm run build:lambda
npm run synth
```

`npm run synth` がテンプレートを出せば、アカウントがなくても構成は確認できます。

`npm run dev:web` と `npm run test:e2e` はこれまでどおりです。デプロイ用ビルドだけ `VITE_API_URL=/api` を使います。slug に `.` が含まれると、再読み込みは静的ファイルの要求になり、`index.html` には戻りません。今のサンプル記事の slug には `.` はありません。

## 一度きりの準備

準備は 3 つです。操作する人の AWS 認証情報が要ります。デプロイのたびに繰り返しません。アカウント ID や OIDC の `sub` の数値は、実行するときに置き換えます。ここには書きません。

### 1. CDK bootstrap

アカウントと `ap-northeast-1` の組で一度だけ実行します。手順の正本は [AWS CDK bootstrapping](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html) です。

```bash
npm --prefix infra run bootstrap -- aws://<account-id>/ap-northeast-1
```

### 2. GitHub OIDC ロール

同じアカウントで、GitHub Actions が引き受ける IAM ロールを一度だけ作ります。認証は OpenID Connect の短期セッションです。長期のアクセスキーは使いません。設定の正本は [Configuring OpenID Connect in Amazon Web Services](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws) です。

OIDC プロバイダがまだ無ければ、URL `https://token.actions.githubusercontent.com`、audience `sts.amazonaws.com` で作ります。プロバイダはアカウントに一つです。

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

信頼する `sub` は、このリポジトリの `main` だけです。2026-07-15 以降に作られたリポジトリ、または immutable subject claims を有効にしたリポジトリでは、所有者 ID とリポジトリ ID が入ります。`<owner-id>` と `<repo-id>` は GitHub の数値 ID です。リポジトリ API の `owner.id` と `id`、または Actions が発行する OIDC トークンの `sub` で確認し、次の形に合わせます。

`repo:<owner>@<owner-id>/<repo>@<repo-id>:ref:refs/heads/main`

ID を含めない設定のリポジトリでは、`repo:<owner>/<repo>:ref:refs/heads/main` です。実際のトークンの形に合わせます。

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
            "token.actions.githubusercontent.com:sub": "repo:<owner>@<owner-id>/<repo>@<repo-id>:ref:refs/heads/main"
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
```

### 3. リポジトリ変数 `AWS_ROLE_ARN`

ロールの ARN をリポジトリ変数に入れます。値はプレースホルダのままにして、`<account-id>` だけを置き換えます。

```bash
gh variable set AWS_ROLE_ARN --repo yamkazu/yohaku \
  --body "arn:aws:iam::<account-id>:role/yohaku-github-deploy"
```

## デプロイ後

初回の API 起動は、テーブルが空ならサンプル記事を 3 件書きます。テーブル名は CDK が決めます。関数の `YOHAKU_TABLE` にその名前が入ります。

スタックを削除しても DynamoDB のテーブルは残ります（`RemovalPolicy.RETAIN`）。
