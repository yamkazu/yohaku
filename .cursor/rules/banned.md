# 禁止パターンと運用で踏んだこと

lint や型で止められるもの（`unwrap` / `expect` / `as` / `dbg!` など）はここに並べない。`api/Cargo.toml` の clippy deny と #34 / #35 側が正本。

## 書いてはいけないこと

1. **新しい Scan**  
   一覧の Scan（`DynamoStore::list_articles`）は既存。同じ型をコピーして Scan を増やさない。置換は別 issue。

2. **`#[allow]` / `#[expect]` で lint を黙らせること**  
   違反は直す。どうしても合わない lint はクレート設定で理由付きにする（#43 の方針）。アイテム単位の黙殺はしない。

3. **workaround コメント**  
   「とりあえずこうしておく」は残さない。直せないなら issue を立ててリンクする。

4. **CI ジョブの `name:` を変えること**  
   `main` の ruleset はチェック名の一致を要求する。#43 で API ジョブ名を一度変えてブロックされた。いまの必須名は `.github/workflows/ci.yml` のまま:
   - `Web (lint + build)`
   - `API (fmt + clippy + build + test)`
   - `E2E (Playwright user harness)`  
   ステップを足すときはジョブ名を変えず、そのジョブの中に step を足す。

5. **共有定数をコメントだけでつないで複製すること**  
   #42 の証拠スクリーンショット名は `scripts/verify.sh` の `EVIDENCE_SHOTS` と `scripts/verify-summary.mjs` の `evidenceNames` と e2e のファイル名が別々に並んでいる。新しい共有値は一つの正本に置き、他はそれを読む。コメントの「shared with …」で並べない。

6. **トレースを整形文字列だけにすること**  
   #41 のレビューどおり、`tracing` はフィールドを残す。`format!("...")` をメッセージにして詳細を溶かす書き方に戻さない（[errors.md](errors.md)）。
