# レビューの観点

yohaku の PR をレビューするときに重く見ることを書く。人のレビュー、`/code-review`、CI のレビューは、どれもこのファイルを観点にする。

## 起きやすい失敗

次の形を見つけたら指摘する。挙げたものがすべてではない。

- DynamoDB の一覧を Scan で作る。全件を読んでからメモリで絞り込み、並べ替える形は、記事が増えるほど重くなる。アクセスパターンに合うキーか GSI で Query する（#58）。
- CSP を破る外部読み込み。CSP の正本は `scripts/cloudfront-security-headers.json` にある。そこに無いオリジンのスクリプト、スタイル、フォント、画像、接続先を足すと、本番のブラウザが読み込みを止める。
- IAM 権限の広げすぎ。CDK の `grant*` やポリシー、GitHub Actions の `permissions:` が、その処理に要る権限より広い。
- `docs/features.md` と実装のずれ。Web の画面や API のルートを足す、変える、消すときに、`docs/features.md` の行を直していない。対象は利用者から見える機能だけで、CI やスクリプトの変更は含まない。

## 指摘の書き方

- 指摘には根拠のファイルと行を付ける。
- 推測では指摘しない。差分とリポジトリの中身で確かめられたことだけを書く。
- 1件の指摘には問題を1つだけ書く。
- 指摘は次の3つに分ける。
  - Important。マージ前に直すべき問題。
  - Nit。直すと良くなるが、マージを止めない問題。1回のレビューで3件まで。
  - Pre-existing。この PR が持ち込んだものではない既存の問題。

## 見ないパス

次のパスの変更はレビューしない。

- vendor した pstack。`.claude/skills/`、`.claude/agents/`、`.claude/docs/`、`.claude/pstack/`
- lock ファイル。`api/Cargo.lock`、`*/package-lock.json`、`*.lock`

## サマリー

サマリーは件数で始める。例は「Important 1件、Nit 2件、Pre-existing 0件」。指摘が無ければ「指摘なし」と書く。
