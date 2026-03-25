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
APP_NAME="Code Trail"
APP_SLUG="CodeTrail"
OUT_DIR="${APP_DIR}/out/${APP_SLUG}-darwin-${ARCH}"
APP_BUNDLE="${OUT_DIR}/${APP_NAME}.app"
ELECTRON_APP="${APP_DIR}/node_modules/electron/dist/Electron.app"
RESOURCES_APP="${APP_BUNDLE}/Contents/Resources/app"
ICON_ICNS="${APP_DIR}/assets/icons/build/codetrail.icns"
APP_BUNDLE_ID="com.codetrail.desktop"
INSTALL_NOTES_PATH="${OUT_DIR}/INSTALL.txt"
PACKAGE_STAGING_ROOT=""
PACKAGE_DIR=""

sign_app_bundle() {
  local bundle_path="$1"
  echo "[5a/5] Re-signing final app bundle ad-hoc..."
  codesign \
    --force \
    --deep \
    --sign - \
    --timestamp=none \
    --identifier "${APP_BUNDLE_ID}" \
    "${bundle_path}"

  echo "[5b/5] Verifying final app bundle..."
  codesign --verify --deep --strict --verbose=2 "${bundle_path}"
}

write_install_notes() {
  cat > "${INSTALL_NOTES_PATH}" <<'EOF'
Code Trail macOS install notes
==============================

1. Move "Code Trail.app" to /Applications if you want.
2. Try opening it normally.
3. If macOS blocks it, right-click the app in Finder and choose "Open".
4. If you still need to allow it manually, run:

   xattr -dr com.apple.quarantine "/Applications/Code Trail.app"

If you did not move it to /Applications, use the app's current path instead.
EOF
}

cleanup_package_staging() {
  if [[ -n "${PACKAGE_STAGING_ROOT}" && -d "${PACKAGE_STAGING_ROOT}" ]]; then
    rm -rf "${PACKAGE_STAGING_ROOT}"
  fi
}

trap cleanup_package_staging EXIT

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
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier ${APP_BUNDLE_ID}" "${PLIST}" >/dev/null 2>&1 || true
fi

if [[ -f "${ICON_ICNS}" ]]; then
  cp "${ICON_ICNS}" "${APP_BUNDLE}/Contents/Resources/${APP_SLUG}.icns"
  if [[ -f "${PLIST}" ]]; then
    /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile ${APP_SLUG}.icns" "${PLIST}" >/dev/null 2>&1 || \
      /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string ${APP_SLUG}.icns" "${PLIST}" >/dev/null 2>&1 || true
  fi
fi

mkdir -p "${RESOURCES_APP}"
cp "${APP_DIR}/package.json" "${RESOURCES_APP}/package.json"
ditto "${APP_DIR}/dist" "${RESOURCES_APP}/dist"

mkdir -p "${RESOURCES_APP}/node_modules"
PARCEL_WATCHER_PLATFORM="@parcel/watcher-darwin-${ARCH}"
for dep in better-sqlite3 @parcel/watcher "${PARCEL_WATCHER_PLATFORM}" react react-dom; do
  if [[ -d "${APP_DIR}/node_modules/${dep}" ]]; then
    rsync -aL "${APP_DIR}/node_modules/${dep}/" "${RESOURCES_APP}/node_modules/${dep}/"
  fi
done

sign_app_bundle "${APP_BUNDLE}"
write_install_notes

ZIP_PATH="${OUT_DIR}/${APP_SLUG}-${ARCH}.zip"
PACKAGE_STAGING_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${APP_SLUG}-${ARCH}-XXXXXX")"
PACKAGE_DIR="${PACKAGE_STAGING_ROOT}/${APP_SLUG}-${ARCH}"
mkdir -p "${PACKAGE_DIR}"
ditto "${APP_BUNDLE}" "${PACKAGE_DIR}/${APP_NAME}.app"
cp "${INSTALL_NOTES_PATH}" "${PACKAGE_DIR}/INSTALL.txt"
ditto -c -k --sequesterRsrc --keepParent "${PACKAGE_DIR}" "${ZIP_PATH}"

echo "Done. Open artifacts in:"
echo "  ${APP_DIR}/out"
echo
echo "This build is ad-hoc signed only. Users who download the zip from the internet may still"
echo "need to use Finder Open or remove quarantine with:"
echo "  xattr -dr com.apple.quarantine \"${APP_NAME}.app\""
