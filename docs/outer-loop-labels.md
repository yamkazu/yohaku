# outer loop 用のラベル

outer loop は、issue の本文とこの3つのラベルだけで、作業をコーディングエージェントに渡してよいかを判断します。ラベルは Kazuki がリポジトリに手で作ります。付ける workflow はありません。

本文の型は `.github/ISSUE_TEMPLATE/task.yml` です。提出後の見出しは、目的 / 今 / やること / やらないこと / 依存 / 検証です。渡してよいかは「依存」と「やらないこと」を見て決めます。

## 定義

| 名前 | 色 | 意味 | 付けるとき |
|---|---|---|---|
| `agent-ready` | `#0E8A16` | 依存が閉じていて、コーディングエージェントに渡せる | 「依存」が「なし」、または挙げた番号がすべて閉じている。かつ `needs-human` ではない |
| `blocked` | `#D93F0B` | 依存待ちで、まだ渡せない | 「依存」に、まだ開いている番号がある |
| `needs-human` | `#5319E7` | 人が行う。テーブル削除、権限変更、デプロイ方法の変更など | テーブル削除、権限変更、デプロイ方法の変更。戻せない操作や権限に触れる、同じ種類の作業 |

色は6桁の16進です。`bug`（`#d73a4a`）を含む既定ラベルとは別の色です。`needs-human` は赤にしないので、不具合と読み間違えません。

## 同時に付けるとき

- `agent-ready` と `blocked` は同時に付けません。
- `agent-ready` と `needs-human` は同時に付けません。
- `blocked` と `needs-human` は同時に付けてよいです。人がやる作業が、さらに依存待ちのときです。

「依存」が空で、閉じているかどうかが読めないときは、`agent-ready` も `blocked` も付けません。

## 人が行う作業

次は `needs-human` です。エージェントには渡しません。

- テーブルを削除する
- 権限を変える。IAM、GitHub の権限、OIDC の信頼先を含む
- デプロイ方法を変える。何をどのワークフローでデプロイするか、その手順自体を変える

実装だけをエージェントに任せられる作業は、ここには入れません。

## 作り方

Kazuki が手で実行します。workflow からは作りません。同名があるときは失敗します。そのときは上書きしません。

`gh label create` の `--color` は `#` なしの6桁です。説明文は上の表の「意味」と同じです。

```bash
gh label create agent-ready --repo yamkazu/yohaku --color 0E8A16 --description "依存が閉じていて、コーディングエージェントに渡せる"
gh label create blocked --repo yamkazu/yohaku --color D93F0B --description "依存待ちで、まだ渡せない"
gh label create needs-human --repo yamkazu/yohaku --color 5319E7 --description "人が行う。テーブル削除、権限変更、デプロイ方法の変更など"
```
