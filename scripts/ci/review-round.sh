#!/usr/bin/env bash
# Claude レビューのラウンドを決める。数え方は docs/code-review.md。
# PR のコメントに残した印 `<!-- claude-review round=N sha=SHA -->` を数え、
# 次に何をするかを $GITHUB_OUTPUT に書く。
#
#   action=review  round=<N>  since=<前回レビューした SHA。1ラウンド目は空>
#   action=cap     上限を超えた。見直しを促すコメントをまだ出していない
#   action=skip    このコミットはレビュー済み、または上限のコメントも出し済み
#
# 使い方（workflow から）:
#   GH_TOKEN=... REPO=owner/name PR=12 HEAD_SHA=... MAX_ROUNDS=3 bash scripts/ci/review-round.sh
set -euo pipefail

: "${REPO:?}" "${PR:?}" "${HEAD_SHA:?}" "${MAX_ROUNDS:?}"
OUT="${GITHUB_OUTPUT:-/dev/stdout}"

bodies="$(gh api --paginate "repos/${REPO}/issues/${PR}/comments" \
  --jq '.[] | select(.user.login == "github-actions[bot]") | .body')"

rounds="$(grep -oE '<!-- claude-review round=[0-9]+ sha=[0-9a-f]{40} -->' <<<"$bodies" || true)"
done_count="$(grep -c . <<<"$rounds" || true)"
last_sha="$(tail -n1 <<<"$rounds" | grep -oE '[0-9a-f]{40}' || true)"

if [[ "$last_sha" == "$HEAD_SHA" ]]; then
  echo "action=skip" >>"$OUT"
  echo "already reviewed ${HEAD_SHA}"
  exit 0
fi

round=$((done_count + 1))
if (( round > MAX_ROUNDS )); then
  if grep -q '<!-- claude-review cap -->' <<<"$bodies"; then
    echo "action=skip" >>"$OUT"
  else
    echo "action=cap" >>"$OUT"
  fi
  echo "round ${round} exceeds ${MAX_ROUNDS}"
  exit 0
fi

# force-push で前回の SHA が今の履歴から消えていたら、PR 全体を見直す。
since=""
if [[ -n "$last_sha" ]] && git merge-base --is-ancestor "$last_sha" "$HEAD_SHA" 2>/dev/null; then
  since="$last_sha"
fi

{
  echo "action=review"
  echo "round=${round}"
  echo "since=${since}"
} >>"$OUT"
echo "round ${round}/${MAX_ROUNDS}, since=${since:-<PR base>}"
