#!/usr/bin/env bash
# Steps shared by GitHub Actions (.github/workflows/ci.yml) and `npm run verify`.
# Run from anywhere; paths are anchored at the repository root.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

usage() {
  cat <<'EOF'
usage: scripts/ci/run.sh <step>

steps:
  web-install          npm ci in web/
  web-lint             oxlint
  web-build            tsc + vite build
  dynamodb             start DynamoDB Local and wait until the port is open
  api-fmt              cargo fmt --check
  api-clippy           cargo clippy --features integration -D warnings
  api-build            cargo build --locked --features integration
  api-test             cargo test --locked --features integration
  api-start            start the debug API binary and wait for /health
  e2e-install          npm ci in e2e/
  playwright-install   install Chromium for Playwright
  e2e                  playwright test (existing feed → article journey)
EOF
}

port_open() {
  local port="$1"
  (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1
}

wait_port() {
  local port="$1"
  local label="$2"
  local seconds="$3"
  local i
  for i in $(seq 1 "$seconds"); do
    if port_open "$port"; then
      echo "${label} ready on :${port}"
      return 0
    fi
    if (( i % 10 == 0 )); then
      echo "waiting for ${label} on :${port} (${i}s)"
    fi
    sleep 1
  done
  echo "${label} failed to start on :${port}" >&2
  return 1
}

start_dynamodb() {
  local port="${DYNAMODB_PORT:-8000}"
  local pid_file="${DYNAMODB_PID_FILE:-/tmp/dynamodb-local.pid}"
  local log_file="${DYNAMODB_LOG:-/tmp/dynamodb-local.log}"

  if ! command -v java >/dev/null 2>&1; then
    echo "java is required for DynamoDB Local (see README)" >&2
    exit 1
  fi
  if port_open "$port"; then
    echo "port ${port} is already in use; stop that process and retry" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$log_file")" "$(dirname "$pid_file")"
  # Survives this script exiting so CI's next step (and verify) can use it.
  bash "$ROOT/scripts/start-dynamodb.sh" >"$log_file" 2>&1 < /dev/null &
  local pid=$!
  disown "$pid" 2>/dev/null || true
  echo "$pid" >"$pid_file"
  echo "DynamoDB Local pid ${pid} (log ${log_file})"

  if ! wait_port "$port" "DynamoDB Local" 120; then
    echo "---- ${log_file} ----" >&2
    cat "$log_file" >&2 || true
    exit 1
  fi
}

start_api() {
  local port="${PORT:-3848}"
  local pid_file="${API_PID_FILE:-/tmp/yohaku-api.pid}"
  local log_file="${API_LOG:-/tmp/yohaku-api.log}"
  local bin="$ROOT/api/target/debug/yohaku-api"

  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to wait for the API" >&2
    exit 1
  fi
  if [[ ! -x "$bin" ]]; then
    echo "API binary missing at ${bin}; run api-build first" >&2
    exit 1
  fi
  if port_open "$port"; then
    echo "port ${port} is already in use; stop that process and retry" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$log_file")" "$(dirname "$pid_file")"
  "$bin" >"$log_file" 2>&1 < /dev/null &
  local pid=$!
  disown "$pid" 2>/dev/null || true
  echo "$pid" >"$pid_file"
  echo "API pid ${pid} (log ${log_file}, table ${YOHAKU_TABLE:-yohaku})"

  local i
  for i in $(seq 1 60); do
    if curl -sf "http://127.0.0.1:${port}/health" >/dev/null; then
      echo "API ready on :${port}"
      return 0
    fi
    if (( i % 10 == 0 )); then
      echo "waiting for API on :${port} (${i}s)"
    fi
    sleep 1
  done
  echo "API failed to start on :${port}" >&2
  echo "---- ${log_file} ----" >&2
  cat "$log_file" >&2 || true
  exit 1
}

cmd="${1:-}"
case "$cmd" in
  web-install)
    (cd "$ROOT/web" && npm ci)
    ;;
  web-lint)
    (cd "$ROOT/web" && npm run lint)
    ;;
  web-build)
    (cd "$ROOT/web" && npm run build)
    ;;
  dynamodb)
    start_dynamodb
    ;;
  api-fmt)
    (cd "$ROOT/api" && cargo fmt --check)
    ;;
  api-clippy)
    # integration enables the DynamoDB Local tests; clippy sees the same crate CI does.
    (cd "$ROOT/api" && cargo clippy --locked --features integration -- -D warnings)
    ;;
  api-build)
    (cd "$ROOT/api" && cargo build --locked --features integration)
    ;;
  api-test)
    (cd "$ROOT/api" && cargo test --locked --features integration)
    ;;
  api-start)
    start_api
    ;;
  e2e-install)
    (cd "$ROOT/e2e" && npm ci)
    ;;
  playwright-install)
    export DEBIAN_FRONTEND=noninteractive
    (cd "$ROOT/e2e" && npx playwright install --with-deps chromium)
    ;;
  e2e)
    (cd "$ROOT/e2e" && npm test)
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    echo "unknown step: ${cmd}" >&2
    usage >&2
    exit 2
    ;;
esac
