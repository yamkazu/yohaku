# PR 本文の型

新しい PR の本文は次の見出しをこの順で書く。手本は [#33](https://github.com/yamkazu/yohaku/pull/33)。

## Why

なぜ今この変更が要るか。失敗や欠落を一文で。

## What changed

実際に触ったファイルと挙動。箇条書きでよい。

## Scope

入れるもの / 入れないもの。依存 issue や後続に残す作業があればここに書く。

## Tradeoffs

選んだ道と捨てた道。短く。

## Blast Radius

マージ後に誰の何が壊れうるか。本番・CI・ローカル verify のどれに効くか。

## Verification

実行したコマンドと結果。`npm run verify` の成否、issue 固有のチェック、必要ならログやパス。

issue を閉じるときは本文末に `Closes #<n>` を付ける。
