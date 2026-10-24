# Claude のコードレビュー

同じリポジトリのブランチから出た PR には、`.github/workflows/claude-review.yml` が Claude のレビューを付けます。draft の間と fork からの PR では動きません。`Claude review` の job は、人が見るべき PR で赤になります。今は必須チェックではありませんが、AI の自動マージを入れるときは、全チェックが緑であることをマージの条件にする前提です。

レビューの中身は Claude Code の `/code-review --comment` です。指摘は行コメントで、先頭に **Important** / **Nit** / **Pre-existing** のどれかが付きます。ルートに `REVIEW.md` があれば観点として読みます。

認証は Secret `CLAUDE_CODE_OAUTH_TOKEN` です。`claude setup-token` で発行するサブスクのトークンで、API の従量課金は使いません。トークンが切れたらレビューの job が失敗するので、発行し直して Secret を上書きします。

## Important が残っていたら失敗する

Claude が付けた **Important** の行コメントのうち、未解決のスレッドが1つでも残っていると、`Claude review` の job が失敗します（`scripts/ci/review-important.sh`）。直したらスレッドを resolve し、次の push で緑に戻ります。resolve だけでは workflow が走らないので、push のない resolve で緑にしたいときは job を re-run します。

直さずに通すと決めた指摘も、理由を返信してから resolve します。上限に達した後の push でもこの判定は毎回走ります。必須チェックにするかはルールセットの話で、ここでは決めていません。

## ラウンドの数え方

push のたびにレビューが1回走り、1回を1ラウンドと数えます。上限は workflow の `MAX_ROUNDS`（今は3）です。

数えるのは `scripts/ci/review-round.sh` です。レビューが最後まで済んだら、workflow が次の印を含むコメントを PR に1つ残します。

```
<!-- claude-review round=N sha=<レビューしたコミット> -->
```

次の実行は、`github-actions[bot]` が書いたこの印を数えます。

- 印の数に1を足したものが今回のラウンドです。
- 最後の印の SHA が今の HEAD と同じなら、レビュー済みなので何もしません。
- 2ラウンド目からは、最後の印の SHA から HEAD までの差分だけを見ます。force-push でその SHA が今の履歴に無いときは、PR 全体を見ます。
- 既に付いている行コメントと同じ指摘は出しません。

Claude には、指摘が無くても最後に要約コメントを1つ書かせます。実行中に Claude のコメントが1つも付かなかったら、job を失敗にして印を残しません。途中で失敗したり、新しい push で取り消されたりした実行も、印を残さないのでラウンドに数えません。

## 止め方

ラウンドが上限を超えると、行コメントはやめて、やり方の見直しを促すコメントを1つだけ出します（印は `<!-- claude-review cap -->`）。その後の push ではレビューしません。上限を超えた PR は人が見る段階なので、`Claude review` の job は失敗のままにします。

指摘と修正が往復して止まらないのは、修正を重ねるより、やり方を人が見直すべき合図です。

もう一度レビューを回したいときは、PR の印付きコメントを消します。消した分だけラウンドが戻ります。

## セキュリティレビュー

同じリポジトリのブランチから出た PR には、`.github/workflows/claude-security-review.yml` が Claude の `/security-review` を付けます。draft でも動きます。fork からの PR では動きません。認証はコードレビューと同じ `CLAUDE_CODE_OAUTH_TOKEN` です。API キーベースの `claude-code-security-review` は使いません。

観点と除外はリポジトリ直下の `SECURITY_REVIEW.md` です。ローカルで `/security-review` を回すときも、同じファイルを読んでください。

指摘は行コメントで、先頭に **Security** が付きます。必須チェックにはしていません。

### 誤検知の閉じ方

セキュリティレビューの指摘が誤検知なら、直さずに通すと決めたときと同じく、**理由を返信してから**スレッドを resolve します。理由のない resolve は残しません。後から見ても、なぜ通したかが分かるようにします。

## CodeQL

`.github/workflows/codeql.yml` が TypeScript（`web/`・`e2e/`・`infra/`）と Rust（`api/`）を code scanning します。結果はリポジトリの Security タブに出ます。必須チェックにはしていません。アラートを直すか、理由を付けて dismiss するかは人が決めます。
