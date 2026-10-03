#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export VITE_API_URL=/api
npm --prefix "$ROOT/web" run build
if grep -R -q "127.0.0.1:3848" "$ROOT/web/dist"; then
  echo "web/dist still calls http://127.0.0.1:3848" >&2
  exit 1
fi
if ! grep -R -q '/api' "$ROOT/web/dist"; then
  echo "web/dist does not call /api" >&2
  exit 1
fi
