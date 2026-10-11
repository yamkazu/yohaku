#!/usr/bin/env bash
set -euo pipefail

site_url_from_log() {
  local matches urls
  matches="$(grep -oE 'Yohaku\.SiteUrl = [^[:space:]]+' || true)"
  urls="$(printf '%s\n' "$matches" | sed -n 's/^Yohaku\.SiteUrl = //p' | grep -E '^https://[a-z0-9]+\.cloudfront\.net$' | sort -u || true)"
  if [[ -z "$urls" ]]; then
    echo "Deploy log did not publish Yohaku.SiteUrl" >&2
    exit 1
  fi
  if [[ "$(printf '%s\n' "$urls" | wc -l)" -ne 1 ]]; then
    echo "Deploy log published more than one SiteUrl" >&2
    exit 1
  fi
  printf '%s\n' "$urls"
}

if [[ "${1:-}" == "--site-url-from-log" ]]; then
  site_url_from_log
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
eval "$(
  python3 - "$ROOT/scripts/cloudfront-security-headers.json" <<'PY'
import json, shlex, sys
spec = json.load(open(sys.argv[1]))
print(f"expect_hsts={shlex.quote(spec['strictTransportSecurity'])}")
print(f"expect_cto={shlex.quote(spec['contentTypeOptions'])}")
print(f"expect_frame={shlex.quote(spec['frameOptions'])}")
print(f"expect_csp={shlex.quote(spec['contentSecurityPolicy'])}")
PY
)"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fail() {
  echo "smoke: $*" >&2
  exit 1
}

header_value() {
  local file="$1" name="$2" lower
  lower="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')"
  tr -d '\r' <"$file" | awk -v name="$lower" '
    {
      keylen = length(name) + 1
      if (tolower(substr($0, 1, keylen)) == name ":") {
        value = $0
        sub(/^[^:]*:[[:space:]]*/, "", value)
      }
    }
    END { printf "%s", value }
  '
}

require_security_headers() {
  local name="$1" got
  got="$(header_value "$tmp/$name.headers" strict-transport-security)"
  [[ "$got" == "$expect_hsts" ]] || fail "$name strict-transport-security $got"
  got="$(header_value "$tmp/$name.headers" x-content-type-options)"
  [[ "$got" == "$expect_cto" ]] || fail "$name x-content-type-options $got"
  got="$(header_value "$tmp/$name.headers" x-frame-options)"
  [[ "$got" == "$expect_frame" ]] || fail "$name x-frame-options $got"
  got="$(header_value "$tmp/$name.headers" content-security-policy)"
  [[ "$got" == "$expect_csp" ]] || fail "$name content-security-policy $got"
}

if [[ "${1:-}" == "--self-check" ]]; then
  {
    printf 'HTTP/1.1 200 OK\r\n'
    printf 'Strict-Transport-Security: %s\r\n' "$expect_hsts"
    printf 'X-Content-Type-Options: %s\r\n' "$expect_cto"
    printf 'X-Frame-Options: %s\r\n' "$expect_frame"
    printf 'Content-Security-Policy: %s\r\n' "$expect_csp"
    printf '\r\n'
  } >"$tmp/ok.headers"
  {
    printf 'HTTP/1.1 200 OK\r\n'
    printf 'X-Content-Type-Options: nosniff\r\n'
    printf '\r\n'
  } >"$tmp/bad.headers"
  require_security_headers ok
  if ( require_security_headers bad ) 2>/dev/null; then
    fail "expected missing headers to fail"
  fi
  echo "smoke self-check ok"
  exit 0
fi

site="${SITE_URL:?}"
if ! [[ "$site" =~ ^https://[a-z0-9]+\.cloudfront\.net$ ]]; then
  echo "refusing site url" >&2
  exit 1
fi
host="${site#https://}"
user_agent="YohakuDeploySmoke/1.0"
canary_slug="deploy-smoke-canary"

fetch() {
  local name="$1" url="$2" code
  code="$(curl -sS -A "$user_agent" --max-redirs 0 --max-time 20 -D "$tmp/$name.headers" -o "$tmp/$name.body" -w '%{http_code}' "$url")" || fail "request $url"
  printf '%s' "$code" >"$tmp/$name.code"
}

code_of() {
  cat "$tmp/$1.code"
}

require_status() {
  local name="$1" expect="$2" got
  got="$(code_of "$name")"
  [[ "$got" == "$expect" ]] || fail "$name status $got, expected $expect"
}

require_type() {
  local name="$1" expect="$2" got
  got="$(header_value "$tmp/$name.headers" content-type)"
  case "$got" in
    "$expect") ;;
    "$expect;"*) ;;
    *) fail "$name content-type $got" ;;
  esac
}

require_https_redirect() {
  local name="$1" path="$2" loc expect
  fetch "$name" "http://$host$path"
  case "$(code_of "$name")" in
    301|302|307|308) ;;
    *) fail "http $path status $(code_of "$name")" ;;
  esac
  loc="$(header_value "$tmp/$name.headers" location)"
  expect="https://$host$path"
  [[ "$loc" == "$expect" ]] || fail "http $path location $loc"
}

require_closed() {
  local name="$1" path="$2" got
  fetch "$name" "$site$path"
  got="$(code_of "$name")"
  case "$got" in
    401|403|404) ;;
    *) fail "$path status $got" ;;
  esac
}

require_app_shell() {
  local name="$1" path="$2"
  fetch "$name" "$site$path"
  require_status "$name" 200
  require_type "$name" text/html
  grep -F -q '余白 — 技術を、余白とともに' "$tmp/$name.body" || fail "$path is not the public app"
  cmp -s "$tmp/home.body" "$tmp/$name.body" || fail "$path is not the public app"
}

reject_secrets() {
  if grep -E -q 'AKIA[0-9A-Z]{16}|AWS_SECRET_ACCESS_KEY|BEGIN PRIVATE KEY|ListBucketResult' "$tmp"/*.body; then
    fail "response leaked a secret or a bucket listing"
  fi
}

require_https_redirect root /
require_https_redirect api-http /api/health

fetch home "$site/"
require_status home 200
require_type home text/html
grep -F -q '余白 — 技術を、余白とともに' "$tmp/home.body" || fail "home is not the public app"
# S3 SSE-S3 (BucketEncryption.S3_MANAGED) on static responses, not a browser security header.
enc="$(header_value "$tmp/home.headers" x-amz-server-side-encryption)"
[[ "$enc" == "AES256" ]] || fail "home encryption header $enc"
require_security_headers home

require_app_shell article "/articles/$canary_slug"

fetch health "$site/api/health"
require_status health 200
require_type health application/json
printf '%s' '{"status":"ok","service":"yohaku-api","store":"dynamodb"}' >"$tmp/health.expected"
cmp -s "$tmp/health.body" "$tmp/health.expected" || fail "health body"
require_security_headers health

fetch articles "$site/api/articles"
require_status articles 200
require_type articles application/json
python3 -c 'import json,sys; slug=sys.argv[2]; rows=json.load(open(sys.argv[1])); assert isinstance(rows, list); assert all(row.get("slug")!=slug for row in rows)' "$tmp/articles.body" "$canary_slug" || fail "canary is in the public list"

fetch article-api "$site/api/articles/$canary_slug"
require_status article-api 200
require_type article-api application/json
python3 -c 'import json,sys; slug=sys.argv[2]; d=json.load(open(sys.argv[1])); assert d.get("slug")==slug and d.get("title")=="Deploy smoke canary" and "error" not in d' "$tmp/article-api.body" "$canary_slug" || fail "canary article"

require_closed env /.env
require_closed git /.git/config
if grep -E -q '^[A-Za-z0-9_]+=' "$tmp/env.body"; then
  fail ".env contents"
fi
if grep -F -q '[core]' "$tmp/git.body"; then
  fail "git config"
fi

require_closed api-admin /api/admin
require_closed api-debug /api/debug

require_app_shell admin /admin
require_app_shell debug /debug

reject_secrets
