#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if ! cargo lambda build --help >/dev/null 2>&1; then
  echo "cargo-lambda is not installed. Install it and put zig on PATH." >&2
  exit 1
fi
if ! command -v zig >/dev/null 2>&1; then
  echo "zig is not on PATH. cargo-lambda uses it to pin glibc 2.34." >&2
  exit 1
fi

cd "$ROOT/api"
cargo lambda build --release --locked --target aarch64-unknown-linux-gnu.2.34

BIN="$ROOT/api/target/lambda/yohaku-api/bootstrap"
if [[ ! -x "$BIN" ]]; then
  echo "missing $BIN" >&2
  exit 1
fi

if ! file "$BIN" | grep -q 'ARM aarch64'; then
  echo "bootstrap is not an aarch64 binary: $(file "$BIN")" >&2
  exit 1
fi

python3 - "$BIN" <<'PY'
import re, subprocess, sys
path = sys.argv[1]
out = subprocess.check_output(["objdump", "-T", path], text=True, errors="replace")
versions = []
for match in re.findall(r"GLIBC_([0-9]+(?:\.[0-9]+)*)", out):
    versions.append(tuple(int(part) for part in match.split(".")))
if not versions:
    sys.exit("no GLIBC symbols in bootstrap")
highest = max(versions)
if len(highest) < 2:
    sys.exit(f"could not parse glibc versions, highest raw tuple {highest}")
limit = (2, 34)
rendered = ".".join(str(part) for part in highest)
if highest > limit:
    sys.exit(f"bootstrap needs GLIBC_{rendered}, Amazon Linux 2023 has 2.34")
print(f"bootstrap glibc {rendered}")
PY
