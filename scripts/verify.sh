#!/usr/bin/env bash
# `npm run verify` の本体。
# `run.sh` のステップを順に呼び、ログを `.verify/` に残し、終了時に DynamoDB と API を止める。
# `--only` のときは、指名したステップと、それが動くために要る前提だけを実行する。
#
# 使い方:
#   npm run verify
#   npm run verify -- --only api-test
#   npm run verify -- --only web-lint,web-build
#   bash scripts/verify.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERIFY_DIR="$ROOT/.verify"
RUN="$ROOT/scripts/ci/run.sh"
STEPS_FILE="$VERIFY_DIR/steps.jsonl"

# 全実行の順番。1行が1ステップ。足すときはこの配列に1行、本体は scripts/ci/run.sh。
# --only が引き込む前提は step_deps だけに書く。前提が無いステップは step_deps を触らない。
ALL_STEPS=(
  web-install
  web-lint
  web-build
  dynamodb
  api-fmt
  api-clippy
  api-deny
  api-build
  api-test
  api-start
  e2e-install
  playwright-install
  e2e
)

# e2e/tests/feed-to-article.spec.ts が test-results/evidence/ に書く。成功時も .verify/screenshots/ へ残す。
EVIDENCE_SHOTS=(
  article-list.png
  article-detail.png
  not-found.png
)

FAILED_STEP=""
CLEANED=0
RUN_ALL=1
SELECTED=""
REQUESTED=()

now_ms() {
  node -e 'process.stdout.write(String(Date.now()))'
}

record() {
  local name="$1"
  local status="$2"
  local exit_code="$3"
  local duration_ms="$4"
  local log_path="$5"
  node -e '
    const [name, status, exitCode, durationMs, log] = process.argv.slice(1);
    const row = {
      name,
      status,
      exitCode: exitCode === "null" ? null : Number(exitCode),
      durationMs: durationMs === "null" ? null : Number(durationMs),
      log: log === "null" ? null : log,
    };
    process.stdout.write(JSON.stringify(row) + "\n");
  ' "$name" "$status" "$exit_code" "$duration_ms" "$log_path" >>"$STEPS_FILE"
}

tee_append() {
  local file="$1"
  if command -v stdbuf >/dev/null 2>&1; then
    stdbuf -oL tee -a "$file"
  else
    tee -a "$file"
  fi
}

run_step() {
  local name="$1"
  shift
  local log="$VERIFY_DIR/${name}.log"
  local start end rc dur
  echo "==> ${name}"
  printf '+ %s\n' "$*" >"$log"
  start="$(now_ms)"
  set +e
  "$@" 2>&1 | tee_append "$log"
  rc=${PIPESTATUS[0]}
  set -e
  end="$(now_ms)"
  dur=$((end - start))
  if [[ "$rc" -eq 0 ]]; then
    record "$name" passed 0 "$dur" ".verify/${name}.log"
    echo "    ok (${dur}ms)"
    return 0
  fi
  record "$name" failed "$rc" "$dur" ".verify/${name}.log"
  FAILED_STEP="$name"
  echo "    FAILED ${name} (exit ${rc}). log: .verify/${name}.log" >&2
  exit "$rc"
}

stop_pid() {
  local pid="$1"
  local pattern="$2"
  local cmdline
  [[ -n "$pid" ]] || return 0
  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  cmdline="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  # Unquoted so `|` stays an alternation. Empty cmdline means ps could not
  # read it; the pid file is ours, so still stop it.
  if [[ -n "$cmdline" && ! "$cmdline" =~ $pattern ]]; then
    echo "leave pid ${pid} running (${cmdline})" >&2
    return 0
  fi
  pkill -TERM -P "$pid" 2>/dev/null || true
  kill -TERM "$pid" 2>/dev/null || true
  local _
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 0.2
  done
  pkill -KILL -P "$pid" 2>/dev/null || true
  kill -KILL "$pid" 2>/dev/null || true
}

stop_recorded() {
  local file="$1"
  local pattern="$2"
  [[ -f "$file" ]] || return 0
  stop_pid "$(cat "$file")" "$pattern"
}

copy_playwright() {
  local dest="$VERIFY_DIR/playwright"
  local copied=0
  rm -rf "$dest"
  mkdir -p "$dest"
  if [[ -d "$ROOT/e2e/test-results" ]]; then
    cp -a "$ROOT/e2e/test-results" "$dest/test-results"
    copied=1
  fi
  if [[ -d "$ROOT/e2e/playwright-report" ]]; then
    cp -a "$ROOT/e2e/playwright-report" "$dest/playwright-report"
    copied=1
  fi
  if [[ "$copied" -eq 0 ]]; then
    rm -rf "$dest"
  fi
}

copy_evidence() {
  local src="$ROOT/e2e/test-results/evidence"
  local dest="$VERIFY_DIR/screenshots"
  local name
  local -a missing=()
  for name in "${EVIDENCE_SHOTS[@]}"; do
    if [[ -s "$src/$name" ]]; then
      mkdir -p "$dest" || return 1
      cp -a "$src/$name" "$dest/$name" || return 1
    else
      missing+=("$name")
    fi
  done
  if e2e_passed && [[ ${#missing[@]} -gt 0 ]]; then
    local msg="e2e passed but evidence screenshots are missing: ${missing[*]}"
    echo "$msg" >&2
    printf '%s\n' "$msg" >"$VERIFY_DIR/evidence-error.txt"
    return 1
  fi
  return 0
}

e2e_passed() {
  [[ -f "$STEPS_FILE" ]] || return 1
  grep -q '"name":"e2e","status":"passed"' "$STEPS_FILE"
}

mark_skipped() {
  [[ -n "$FAILED_STEP" ]] || return 0
  local seen=0
  local name
  for name in "${ALL_STEPS[@]}"; do
    if [[ "$seen" -eq 1 ]]; then
      record "$name" skipped null null null
    fi
    if [[ "$name" == "$FAILED_STEP" ]]; then
      seen=1
    fi
  done
}

cleanup() {
  local rc=$?
  local evidence_rc=0
  if [[ "$CLEANED" -eq 1 ]]; then
    exit "$rc"
  fi
  CLEANED=1
  set +e
  stop_recorded "$VERIFY_DIR/api.pid" "yohaku-api"
  stop_recorded "$VERIFY_DIR/dynamodb.pid" "DynamoDBLocal|start-dynamodb"
  if [[ "$FAILED_STEP" == "e2e" ]]; then
    copy_playwright
  fi
  copy_evidence || evidence_rc=$?
  if [[ "$rc" -eq 0 && "$evidence_rc" -ne 0 ]]; then
    rc=$evidence_rc
  fi
  mark_skipped
  node "$ROOT/scripts/verify-summary.mjs" "$VERIFY_DIR" "$rc"
  if [[ "$rc" -eq 0 ]]; then
    echo "verify passed (.verify/summary.json)"
    if [[ -d "$VERIFY_DIR/screenshots" ]]; then
      echo "evidence: .verify/screenshots/"
    fi
  else
    echo "verify failed (.verify/summary.json)" >&2
  fi
  exit "$rc"
}

usage() {
  cat <<EOF
usage:
  npm run verify
  npm run verify -- --only <step>[,<step>...]

No arguments runs every step.

--only runs the named steps plus the prerequisites they need
(DynamoDB Local, the API, installs, and builds), then stops what
this run started. Name the step you care about; do not assemble
the prerequisite list yourself. Steps that did not run are recorded
as skipped in .verify/summary.json.

steps:
$(printf '  %s\n' "${ALL_STEPS[@]}")
EOF
}

die_usage() {
  echo "$1" >&2
  echo >&2
  usage >&2
  exit 2
}

is_known_step() {
  local name="$1"
  local step
  for step in "${ALL_STEPS[@]}"; do
    [[ "$step" == "$name" ]] && return 0
  done
  return 1
}

# 直接の前提だけ。推移は select_step が閉じる。新しいステップはここが空なら前提なし。
step_deps() {
  case "$1" in
    web-lint|web-build) printf '%s\n' web-install ;;
    api-test) printf '%s\n' dynamodb ;;
    api-start) printf '%s\n' dynamodb api-build ;;
    playwright-install) printf '%s\n' e2e-install ;;
    e2e) printf '%s\n' api-start web-build playwright-install ;;
  esac
}

selected_contains() {
  [[ " $SELECTED " == *" $1 "* ]]
}

select_step() {
  local name="$1"
  local dep
  if selected_contains "$name"; then
    return 0
  fi
  # 先に印を付ける。前提の循環で再帰が終わらなくなるのを防ぐ。
  SELECTED="$SELECTED $name"
  for dep in $(step_deps "$name"); do
    select_step "$dep"
  done
}

should_run() {
  [[ "$RUN_ALL" -eq 1 ]] && return 0
  selected_contains "$1"
}

directly_requested() {
  local name="$1"
  local item
  [[ ${#REQUESTED[@]} -eq 0 ]] && return 1
  for item in "${REQUESTED[@]}"; do
    [[ "$item" == "$name" ]] && return 0
  done
  return 1
}

validate_graph() {
  local name dep
  for name in "${ALL_STEPS[@]}"; do
    for dep in $(step_deps "$name"); do
      if ! is_known_step "$dep"; then
        echo "internal error: step ${name} depends on unknown step ${dep}" >&2
        exit 1
      fi
      if [[ "$dep" == "$name" ]]; then
        echo "internal error: step ${name} depends on itself" >&2
        exit 1
      fi
    done
  done
}

trim_token() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

append_only_list() {
  local raw="$1"
  local part trimmed
  local -a parts=()
  # `read` drops a trailing empty field, so reject blank slots before splitting.
  if [[ -z "${raw//[[:space:]]/}" || "$raw" =~ (^|,)[[:space:]]*(,|$) ]]; then
    die_usage "empty step in --only list: ${raw}"
  fi
  IFS=',' read -r -a parts <<<"$raw"
  if [[ ${#parts[@]} -eq 0 ]]; then
    die_usage "--only needs a step name. Example: npm run verify -- --only api-test"
  fi
  for part in "${parts[@]}"; do
    trimmed="$(trim_token "$part")"
    if [[ -z "$trimmed" ]]; then
      die_usage "empty step in --only list: ${raw}"
    fi
    if ! directly_requested "$trimmed"; then
      REQUESTED+=("$trimmed")
    fi
  done
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      ;;
    --only)
      if [[ $# -lt 2 || -z "${2:-}" || "$2" == -* ]]; then
        die_usage "--only needs a step name. Example: npm run verify -- --only api-test"
      fi
      append_only_list "$2"
      shift 2
      ;;
    --only=*)
      if [[ -z "${1#--only=}" ]]; then
        die_usage "--only needs a step name. Example: npm run verify -- --only api-test"
      fi
      append_only_list "${1#--only=}"
      shift
      ;;
    *)
      echo "unknown argument: $1" >&2
      if is_known_step "$1"; then
        echo "to run one step: npm run verify -- --only $1" >&2
      else
        echo "to run one step: npm run verify -- --only <step>" >&2
      fi
      echo >&2
      usage >&2
      exit 2
      ;;
  esac
done

validate_graph

if [[ ${#REQUESTED[@]} -gt 0 ]]; then
  RUN_ALL=0
  for name in "${REQUESTED[@]}"; do
    if ! is_known_step "$name"; then
      echo "unknown step: ${name}" >&2
      echo >&2
      usage >&2
      exit 2
    fi
    select_step "$name"
  done
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required (see README)" >&2
  exit 1
fi

rm -rf "$VERIFY_DIR"
mkdir -p "$VERIFY_DIR"
: >"$STEPS_FILE"
rm -rf "$ROOT/e2e/test-results" "$ROOT/e2e/playwright-report"

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Same local wiring CI uses. Override a leaked AWS profile so this stays on DynamoDB Local.
unset AWS_PROFILE AWS_SESSION_TOKEN AWS_ENDPOINT_URL || true
export AWS_ACCESS_KEY_ID=local
export AWS_SECRET_ACCESS_KEY=local
export AWS_REGION=us-east-1
export AWS_DEFAULT_REGION=us-east-1
export DYNAMODB_PORT="${DYNAMODB_PORT:-8000}"
export DYNAMODB_ENDPOINT="http://127.0.0.1:${DYNAMODB_PORT}"
export PORT="${PORT:-3848}"
export VITE_API_URL="http://127.0.0.1:${PORT}"
export CI=true
export CARGO_TERM_COLOR=never
export npm_config_color=false
export DYNAMODB_PID_FILE="$VERIFY_DIR/dynamodb.pid"
export DYNAMODB_LOG="$VERIFY_DIR/dynamodb-server.log"
export API_PID_FILE="$VERIFY_DIR/api.pid"
export API_LOG="$VERIFY_DIR/api-server.log"

if [[ "$RUN_ALL" -eq 0 ]]; then
  running_line=""
  for name in "${ALL_STEPS[@]}"; do
    if should_run "$name"; then
      running_line+=" ${name}"
    fi
  done
  echo "only: ${REQUESTED[*]}"
  echo "running:${running_line}"
fi

for name in "${ALL_STEPS[@]}"; do
  if ! should_run "$name"; then
    record "$name" skipped null null null
    continue
  fi
  case "$name" in
    api-fmt|api-clippy|api-build|api-test)
      export YOHAKU_TABLE=yohaku-ci
      ;;
    api-start|e2e-install|playwright-install|e2e)
      export YOHAKU_TABLE=yohaku-e2e
      ;;
  esac
  run_step "$name" bash "$RUN" "$name"
done
