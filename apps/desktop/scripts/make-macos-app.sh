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

echo "[1/5] Building app bundles..."
bun run build

echo "[2/5] Verifying native dependency ABI..."
bun run fix:native

echo "[3/5] Materializing Node-style dependency links for Forge..."
node ./scripts/materialize-forge-deps.mjs

echo "[4/5] Building macOS icon assets..."
./scripts/build-app-icon.sh

echo "[5/5] Packaging macOS app for ${ARCH}..."
OUT_DIR="${APP_DIR}/out/CCH-darwin-${ARCH}"
APP_NAME="CCH"
APP_BUNDLE="${OUT_DIR}/${APP_NAME}.app"
ELECTRON_APP="${APP_DIR}/node_modules/electron/dist/Electron.app"
RESOURCES_APP="${APP_BUNDLE}/Contents/Resources/app"
ICON_ICNS="${APP_DIR}/assets/icons/build/codetrail.icns"

if [[ ! -d "${ELECTRON_APP}" ]]; then
  echo "Missing Electron app template at ${ELECTRON_APP}" >&2
  exit 1
fi

rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}"

ditto "${ELECTRON_APP}" "${APP_BUNDLE}"

PLIST="${APP_BUNDLE}/Contents/Info.plist"
if [[ -f "${PLIST}" ]]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleName ${APP_NAME}" "${PLIST}" >/dev/null 2>&1 || true
  /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName ${APP_NAME}" "${PLIST}" >/dev/null 2>&1 || true
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.cch.desktop" "${PLIST}" >/dev/null 2>&1 || true
fi

if [[ -f "${ICON_ICNS}" ]]; then
  cp "${ICON_ICNS}" "${APP_BUNDLE}/Contents/Resources/${APP_NAME}.icns"
  if [[ -f "${PLIST}" ]]; then
    /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile ${APP_NAME}.icns" "${PLIST}" >/dev/null 2>&1 || \
      /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string ${APP_NAME}.icns" "${PLIST}" >/dev/null 2>&1 || true
  fi
fi

mkdir -p "${RESOURCES_APP}"
cp "${APP_DIR}/package.json" "${RESOURCES_APP}/package.json"
ditto "${APP_DIR}/dist" "${RESOURCES_APP}/dist"

mkdir -p "${RESOURCES_APP}/node_modules"
for dep in better-sqlite3 react react-dom; do
  if [[ -d "${APP_DIR}/node_modules/${dep}" ]]; then
    rsync -aL "${APP_DIR}/node_modules/${dep}/" "${RESOURCES_APP}/node_modules/${dep}/"
  fi
done

ZIP_PATH="${OUT_DIR}/${APP_NAME}-${ARCH}.zip"
ditto -c -k --sequesterRsrc --keepParent "${APP_BUNDLE}" "${ZIP_PATH}"

echo "Done. Open artifacts in:"
echo "  ${APP_DIR}/out"
