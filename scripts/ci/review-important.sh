#!/usr/bin/env bash
# Claude が付けた **Important** の行コメントのうち、未解決のスレッドが残っていたら失敗する。
# スレッドを直して resolve し、次の push で緑に戻る。詳しくは docs/code-review.md。
#
# 使い方（workflow から）:
#   GH_TOKEN=... REPO=owner/name PR=12 bash scripts/ci/review-important.sh
set -euo pipefail

: "${REPO:?}" "${PR:?}"

open="$(gh api graphql --paginate \
  -F owner="${REPO%/*}" -F name="${REPO#*/}" -F pr="$PR" \
  -f query='
    query($owner: String!, $name: String!, $pr: Int!, $endCursor: String) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $pr) {
          reviewThreads(first: 100, after: $endCursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              isResolved
              comments(first: 1) { nodes { author { login } body url } }
            }
          }
        }
      }
    }' \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[]
    | select(.isResolved | not)
    | .comments.nodes[0]
    | select(.author.login == "github-actions" and (.body | startswith("**Important")))
    | .url')"

if [[ -z "$open" ]]; then
  echo "no unresolved Important threads"
  exit 0
fi

while IFS= read -r url; do
  echo "::error::unresolved Important review thread: ${url}"
done <<<"$open"
exit 1
