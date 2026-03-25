#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

SOURCE_SVG="${1:-${APP_DIR}/assets/icons/codetrail.svg}"
ICON_BUILD_DIR="${APP_DIR}/assets/icons/build"
ICNS_PATH="${ICON_BUILD_DIR}/codetrail.icns"
SOURCE_PNG="${ICON_BUILD_DIR}/codetrail-1024.png"

if [[ ! -f "${SOURCE_SVG}" ]]; then
  echo "Icon source SVG not found: ${SOURCE_SVG}" >&2
  exit 1
fi

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "rsvg-convert is required to build app icons." >&2
  exit 1
fi

if [[ ! -x "${APP_DIR}/node_modules/.bin/png2icons" ]]; then
  echo "png2icons is required. Run 'bun install' first." >&2
  exit 1
fi

mkdir -p "${ICON_BUILD_DIR}"
rsvg-convert "${SOURCE_SVG}" -w 1024 -h 1024 -o "${SOURCE_PNG}"
"${APP_DIR}/node_modules/.bin/png2icons" "${SOURCE_PNG}" "${ICON_BUILD_DIR}/codetrail" -icns -bc

echo "Built icon assets:"
echo "  ${SOURCE_PNG}"
echo "  ${ICNS_PATH}"
