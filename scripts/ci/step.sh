#!/usr/bin/env bash
# CI wrapper around scripts/ci/run.sh.
# Records each step into `.ci/steps.jsonl` (same row shape as verify) and, on
# failure, writes `.ci/summary.json` via scripts/verify-summary.mjs so the
# workflow can upload a machine-readable failure artifact.
#
# Usage:
#   bash scripts/ci/step.sh web-lint
#   CI_SUMMARY_DIR=/tmp/ci-summary bash scripts/ci/step.sh api-test
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RUN="$ROOT/scripts/ci/run.sh"
SUMMARY_DIR="${CI_SUMMARY_DIR:-$ROOT/.ci}"
STEPS_FILE="$SUMMARY_DIR/steps.jsonl"
STEP="${1:-}"

if [[ -z "$STEP" || "$STEP" == "-h" || "$STEP" == "--help" || "$STEP" == "help" ]]; then
  echo "usage: scripts/ci/step.sh <step>" >&2
  echo "steps: see scripts/ci/run.sh --help" >&2
  exit 2
fi

mkdir -p "$SUMMARY_DIR"

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

# Prefer a path relative to the repo root in summary.json (matches verify).
if [[ "$SUMMARY_DIR" == "$ROOT"/* ]]; then
  rel_log="${SUMMARY_DIR#"$ROOT"/}/${STEP}.log"
else
  rel_log="${SUMMARY_DIR}/${STEP}.log"
fi

log_file="$SUMMARY_DIR/${STEP}.log"
echo "==> ${STEP}"
printf '+ bash scripts/ci/run.sh %s\n' "$STEP" >"$log_file"

start="$(now_ms)"
set +e
bash "$RUN" "$STEP" 2>&1 | tee_append "$log_file"
rc=${PIPESTATUS[0]}
set -e
end="$(now_ms)"
dur=$((end - start))

if [[ "$rc" -eq 0 ]]; then
  record "$STEP" passed 0 "$dur" "$rel_log"
  echo "    ok (${dur}ms)"
  exit 0
fi

record "$STEP" failed "$rc" "$dur" "$rel_log"
node "$ROOT/scripts/verify-summary.mjs" "$SUMMARY_DIR" "$rc"
echo "    FAILED ${STEP} (exit ${rc}). summary: ${SUMMARY_DIR}/summary.json" >&2
exit "$rc"
