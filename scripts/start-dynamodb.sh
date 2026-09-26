#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/tools/dynamodb-local"
JAR="$DIR/DynamoDBLocal.jar"
PORT="${DYNAMODB_PORT:-8000}"

if [[ ! -f "$JAR" ]]; then
  echo "Downloading DynamoDB Local..."
  mkdir -p "$DIR"
  curl -fsSL -o "$DIR/dynamodb_local.tar.gz" \
    "https://d1ni2b6xgvw0s0.cloudfront.net/v2.x/dynamodb_local_2026-07-31.tar.gz"
  tar -xzf "$DIR/dynamodb_local.tar.gz" -C "$DIR"
  rm -f "$DIR/dynamodb_local.tar.gz"
fi

cd "$DIR"
exec java -Djava.library.path=./DynamoDBLocal_lib \
  -jar DynamoDBLocal.jar -sharedDb -port "$PORT"
