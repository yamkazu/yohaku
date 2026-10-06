#!/usr/bin/env bash
# One local run of the same checks CI uses, plus the Playwright journey.
# On failure, .verify/summary.json names the step and keeps its log.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERIFY_DIR="$ROOT/.verify"
RUN="$ROOT/scripts/ci/run.sh"
STEPS_FILE="$VERIFY_DIR/steps.jsonl"

ALL_STEPS=(
  web-install
  web-lint
  web-build
  dynamodb
  api-fmt
  api-clippy
  api-build
  api-test
  api-start
  e2e-install
  playwright-install
  e2e
)

FAILED_STEP=""
CLEANED=0

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
  mark_skipped
  node "$ROOT/scripts/verify-summary.mjs" "$VERIFY_DIR" "$rc"
  if [[ "$rc" -eq 0 ]]; then
    echo "verify passed (.verify/summary.json)"
  else
    echo "verify failed (.verify/summary.json)" >&2
  fi
  exit "$rc"
}

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
export DYNAMODB_PID_FILE="$VERIFY_DIR/dynamodb.pid"
export DYNAMODB_LOG="$VERIFY_DIR/dynamodb-server.log"
export API_PID_FILE="$VERIFY_DIR/api.pid"
export API_LOG="$VERIFY_DIR/api-server.log"

for name in "${ALL_STEPS[@]}"; do
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
