#!/usr/bin/env bash
# CI とローカルで共有するステップディスパッチャ。
# 引数 1 つでステップ名を受け取り、対応するコマンドを実行する。
#
# ステップ: evidence-shots, web-install, web-lint, web-build, dynamodb, api-fmt,
# api-clippy, api-deny, api-build, api-test, api-start, e2e-install,
# playwright-install, e2e
#
# 使い方:
#   bash scripts/ci/run.sh web-lint
#   bash scripts/ci/run.sh --help
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

usage() {
  cat <<'EOF'
usage: scripts/ci/run.sh <step>

steps:
  evidence-shots       assert evidence screenshot names use scripts/evidence-shots.json
  web-install          npm ci in web/
  web-lint             oxlint
  web-build            tsc + vite build
  dynamodb             start DynamoDB Local and wait until the port is open
  api-fmt              cargo fmt --check
  api-clippy           cargo clippy --features integration --all-targets -D warnings
  api-deny             cargo deny check (licenses + advisories)
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

# cargo-deny is not part of the rustup toolchain. Install the pinned release
# into ${CARGO_HOME:-~/.cargo}/bin so CI and `npm run verify` share one binary.
CARGO_DENY_VERSION="0.20.2"

cargo_deny_target() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "${os}-${arch}" in
    Linux-x86_64) echo "x86_64-unknown-linux-musl" ;;
    Linux-aarch64) echo "aarch64-unknown-linux-musl" ;;
    Darwin-x86_64) echo "x86_64-apple-darwin" ;;
    Darwin-arm64) echo "aarch64-apple-darwin" ;;
    *)
      echo "no cargo-deny ${CARGO_DENY_VERSION} build for ${os}-${arch}" >&2
      return 1
      ;;
  esac
}

cargo_deny_sha256() {
  case "$1" in
    x86_64-unknown-linux-musl) echo "9f12ed4c49936e09b48bf862b595cde2fe64fcbd9d74dfacac6131ca824c8d5f" ;;
    aarch64-unknown-linux-musl) echo "995c82be0defc7a025cae49a2aa2644ce8245c9a3318fc4103907c6a285e8c7d" ;;
    x86_64-apple-darwin) echo "248da7f581724e470071990c088ffc55c811981715f4cbdb258621fb79f8b7a6" ;;
    aarch64-apple-darwin) echo "fe67d82a10d8597a3549364cb733a3f9cc1bfff9031b7ae46384a9f2a72090c3" ;;
    *)
      echo "missing checksum for $1" >&2
      return 1
      ;;
  esac
}

ensure_cargo_deny() {
  local bindir="${CARGO_HOME:-$HOME/.cargo}/bin"
  local bin="$bindir/cargo-deny"
  if [[ -x "$bin" ]] && "$bin" --version | grep -q "cargo-deny ${CARGO_DENY_VERSION}"; then
    return 0
  fi

  local target sha name url tmp
  target="$(cargo_deny_target)"
  sha="$(cargo_deny_sha256 "$target")"
  name="cargo-deny-${CARGO_DENY_VERSION}-${target}"
  url="https://github.com/EmbarkStudios/cargo-deny/releases/download/${CARGO_DENY_VERSION}/${name}.tar.gz"
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/cargo-deny.tar.gz" "$url"
  if command -v sha256sum >/dev/null 2>&1; then
    echo "${sha}  $tmp/cargo-deny.tar.gz" | sha256sum -c -
  else
    echo "${sha}  $tmp/cargo-deny.tar.gz" | shasum -a 256 -c -
  fi
  tar -xzf "$tmp/cargo-deny.tar.gz" -C "$tmp"
  mkdir -p "$bindir"
  install -m 755 "$tmp/${name}/cargo-deny" "$bin"
  rm -rf "$tmp"
}

cmd="${1:-}"
case "$cmd" in
  evidence-shots)
    node "$ROOT/scripts/check-evidence-shots.mjs"
    ;;
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
    # integration enables the DynamoDB Local tests; --all-targets lints those too.
    (cd "$ROOT/api" && cargo clippy --locked --features integration --all-targets -- -D warnings)
    ;;
  api-deny)
    ensure_cargo_deny
    (cd "$ROOT/api" && "${CARGO_HOME:-$HOME/.cargo}/bin/cargo-deny" check advisories licenses)
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
