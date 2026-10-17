# 検証レポート（コピペ用）

`SKILL.md` の「報告の形」と同じ構造。値だけ埋めて PR コメントにする。

```markdown
## 検証レポート

- **PR:** #<pr>
- **Issue:** #<issue>
- **検証エージェント:** <agent URL or unknown>
- **結論:** pass | fail | could-not-verify
- **コード変更:** なし

### 実行したコマンド

| # | コマンド | 終了コード |
|---|---|---|
| 1 | `npm run verify` | 0 |

### `.verify/summary.json`

- `ok`: true
- `exitCode`: 0
- `message`: all steps passed
- `steps`: <name>=<status>, …
- `screenshots`: <summary.screenshots の配列をそのまま>

### 検証欄の項目

| # | 検証項目（issue の文言） | 結果 | 実行コマンド | 証拠 |
|---|---|---|---|---|
| 1 | | pass | コマンド #1 | `.verify/summary.json` (`ok`, steps) |

### 機能回帰（`docs/features.md`）

| 機能（表の「機能」列） | たどり方 | 結果 | 証拠 |
|---|---|---|---|
| | | pass | |

### メモ

-
```
