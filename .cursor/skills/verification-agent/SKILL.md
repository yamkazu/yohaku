---
name: verification-agent
description: >-
  Reproduce an issue's 検証 section on a PR written by another agent. Run
  npm run verify (optionally --only), check docs/features.md for regressions,
  and post a fixed-shape result as a PR comment without changing code.
---

# 検証エージェント

このスキルは、**PR を書いたエージェントとは別のエージェント**が使う。
対象 PR のリンク issue の「検証」欄どおりに確かめ、証拠つきで PR にコメントする。

## いつ使うか

- PR が開いた、または更新されたあとに、作者以外のエージェントとして検証を頼まれたとき
- issue に「検証」欄があり、ローカルの `npm run verify` / `docs/features.md` で確かめられるとき

使わないとき:

- コード修正・リベース・マージ（#20 / #21 側）
- Bugbot の代わりの汎用コードレビュー（#45）
- 本番 URL に対する検証

## 硬制約

1. **コードを変えない。** コミット、ブランチ操作、ファイル編集、`git push`、マージ、デプロイはしない。
2. 結果は **PR コメント 1 本**で報告する。PR 本文は書き換えない。
3. 本番環境には当てない。ローカルの `npm run verify` と、それが起動する Web / API / DynamoDB Local だけを使う。
4. スクリーンショットのファイル名は、このスキルに再定義しない。証拠は `.verify/summary.json` の `screenshots` 配列と、`docs/features.md` 末尾の一覧を読む。
5. 失敗ログは `summary.json` の構造化フィールド（`failedStep`、`failedLog`、`logTail`、`apiLogTail`、`serverLogs`、`message`）を引用する。ログ本文を手で要約して別表現に置き換えない。

## 流れ

### 1. 対象と検証欄を読む

1. 検証対象の PR 番号（または URL）を特定する。
2. PR が閉じる／参照する issue を特定する（本文の `Closes #N` / `Refs #N`、または依頼文）。
3. その issue 本文の **「検証:」**（または `検証` 見出し）以下を項目ごとに切り出す。箇条書き 1 行を 1 項目とする。
4. PR の diff / 変更ファイル一覧を読み、あとで `docs/features.md` から影響機能を選ぶ材料にする。まだ直さない。

issue に検証欄が無い場合は、その旨を報告して終了する（コードは触らない）。

### 2. `npm run verify` を流す

リポジトリ根で実行する。

- 変更が広い、または影響範囲がはっきりしない → 全文:

  ```bash
  npm run verify
  ```

- 影響が一部のステップに閉じている → 部分実行:

  ```bash
  npm run verify -- --only <step>[,<step>...]
  ```

  ステップ名は `scripts/verify.sh` の `ALL_STEPS` を正とする。`--only` は前提ステップを自動で足し、終わったら止める。流さなかったステップは `summary.json` で `skipped` になる。

選び方の目安（迷ったら全文）:

| 変更の中心 | `--only` の例 |
|---|---|
| `api/` のテスト・ストア・エラー処理 | `api-test`（必要なら `api-fmt,api-clippy,api-deny,api-test`） |
| `web/` の見た目やルート | `e2e`（必要なら `web-lint,web-build,e2e`） |
| `scripts/verify*` / CI ステップ定義 | 全文（`--only` にしない） |
| ドキュメントのみ（このスキル自身など） | 全文で緑を確認してよい。機能回帰は「変更なし」と書く |

終了後、必ず `.verify/summary.json` を読む。報告に使うフィールド:

- `ok`（boolean）
- `exitCode`
- `message`
- `steps`（各 `name` / `status` / `exitCode` / `log`）
- `screenshots`（相対パスの配列。無いときは `null`）
- 失敗時: `failedStep`、`failedLog`、`logTail`、`apiLogTail`、`serverLogs`

### 3. `docs/features.md` から影響機能を選ぶ

1. `docs/features.md` の表を読む。
2. PR の変更ファイルと検証欄から、**影響を受ける行だけ**を選ぶ。
3. 選んだ行について回帰を確かめる:
   - 表の「テスト」列が指すテストを、手順 2 の `verify`（または追加の `--only`）でカバーできていれば、その結果を使う。
   - カバーできていない行だけ、表の「たどり方」どおりにローカルで追加確認する（例: `curl` で API、または `npm run verify -- --only e2e`）。
4. 画面の証拠が必要な行は、`summary.json` の `screenshots` をそのまま証拠欄に書く。ファイル名の正本は `docs/features.md` 末尾と `scripts/verify.sh` の `EVIDENCE_SHOTS` / `scripts/verify-summary.mjs` の `evidenceNames`（重複して並べ替えない）。

影響する機能が一つも無い（純粋なエージェント向けドキュメントなど）ときは、その判断を報告に書き、機能ごとの回帰は「該当なし」とする。

### 4. 決まった形で PR にコメントする

下記「報告の形」どおりに Markdown を組み立て、対象 PR に **コメントとして投稿**する。

- 通過でも失敗でも、必ずコメントする。
- 失敗していても **コードは直さない。** 修正や再実行の依頼はコメントに事実だけ書く（マージ判断は #21、失敗の受け渡しは #20）。

## 報告の形

コメントは次の見出し構成に固定する。項目名や順番を変えない。

```markdown
## 検証レポート

- **PR:** #<pr>
- **Issue:** #<issue>
- **検証エージェント:** （この実行の識別子。分かれば agent URL / run id。無ければ `unknown`）
- **結論:** pass | fail | could-not-verify
- **コード変更:** なし

### 実行したコマンド

| # | コマンド | 終了コード |
|---|---|---|
| 1 | `npm run verify` または `npm run verify -- --only …` | 0 / 非0 |

### `.verify/summary.json`

- `ok`: true | false
- `exitCode`: <n>
- `message`: <summary.message をそのまま>
- `steps`: 各ステップの `name`=`status`（必要なら `exitCode`）を列挙
- `screenshots`: `summary.screenshots` をそのまま（`null` ならその旨）

失敗時は続けて:

- `failedStep` / `failedLog`
- `logTail`（あれば、要約せずフィールド内容）
- `apiLogTail` / `serverLogs`（あれば）

### 検証欄の項目

| # | 検証項目（issue の文言） | 結果 | 実行コマンド | 証拠 |
|---|---|---|---|---|
| 1 | … | pass \| fail \| could-not-verify | 上表のコマンド # または追加コマンド全文 | `.verify/summary.json`（`ok` / 該当 step）; 画面なら `summary.screenshots` のパス |

結果の意味:

- **pass** — 項目の条件を満たした
- **fail** — 実行したが条件を満たさなかった
- **could-not-verify** — 環境不足・手順がローカル verify の外・再現不能などで確かめられなかった（理由を証拠欄か直後の箇条書きに書く）

### 機能回帰（`docs/features.md`）

| 機能（表の「機能」列） | たどり方 | 結果 | 証拠 |
|---|---|---|---|
| … | … | pass \| fail \| could-not-verify \| n/a | テスト名または `summary.screenshots` のパス |

選んだ行が無いときは 1 行で `該当なし（理由）` と書く。

### メモ

- `--only` を選んだ理由、または全文にした理由
- could-not-verify の理由
- 本番は見ていないこと
```

## やらないこと（再掲）

- ソース、テスト、設定、ワークフロー、ルールの編集
- 失敗の「ついで直し」
- CI ジョブ名の変更や、検証以外のリファクタ
- 本番スモークやデプロイの再実行（Deploy ワークフローの領域）
