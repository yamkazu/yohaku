#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-local}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-local}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export DYNAMODB_ENDPOINT="${DYNAMODB_ENDPOINT:-http://127.0.0.1:8000}"
export YOHAKU_TABLE="${YOHAKU_TABLE:-yohaku}"
export PORT="${PORT:-3848}"
export RUST_LOG="${RUST_LOG:-info}"
cd "$ROOT/api"
exec cargo run
