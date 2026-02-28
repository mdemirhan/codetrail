#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script only supports macOS." >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required. Install bun first." >&2
  exit 1
fi

ARCH_INPUT="${1:-$(uname -m)}"
case "${ARCH_INPUT}" in
  x64|arm64)
    ARCH="${ARCH_INPUT}"
    ;;
  x86_64)
    ARCH="x64"
    ;;
  aarch64)
    ARCH="arm64"
    ;;
  *)
    echo "Unsupported arch '${ARCH_INPUT}'. Use x64 or arm64." >&2
    exit 1
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${APP_DIR}"

if [[ ! -x "./node_modules/.bin/electron-forge" ]]; then
  echo "Missing electron-forge. Run 'bun install' in repository root first." >&2
  exit 1
fi

echo "[1/3] Building app bundles..."
bun run build

echo "[2/3] Verifying native dependency ABI..."
bun run fix:native

echo "[3/3] Packaging macOS app for ${ARCH}..."
./node_modules/.bin/electron-forge make --platform=darwin --arch="${ARCH}" --skip-rebuild

echo "Done. Open artifacts in:"
echo "  ${APP_DIR}/out"
