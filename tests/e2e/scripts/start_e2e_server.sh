#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

HOST="${LINGADOO_E2E_HOST:-127.0.0.1}"
PORT="${LINGADOO_E2E_PORT:-8766}"
BUILD_MODE="${LINGADOO_E2E_BUILD_MODE:-auto}"

APP_ROOT="${REPO_ROOT}"
DIST_INDEX="${APP_ROOT}/dist/index.html"

frontend_build_required() {
  if [[ "${BUILD_MODE}" == "always" ]]; then
    return 0
  fi
  if [[ "${BUILD_MODE}" == "never" ]]; then
    return 1
  fi
  if [[ ! -f "${DIST_INDEX}" ]]; then
    return 0
  fi
  if find \
    "${APP_ROOT}/src" \
    "${APP_ROOT}/public" \
    "${APP_ROOT}/index.html" \
    "${APP_ROOT}/package.json" \
    "${APP_ROOT}/tsconfig.json" \
    "${APP_ROOT}/tsconfig.node.json" \
    "${APP_ROOT}/vite.config.ts" \
    -type f -newer "${DIST_INDEX}" -print -quit 2>/dev/null | grep -q .; then
    return 0
  fi
  return 1
}

if frontend_build_required; then
  echo "[e2e] Building frontend bundle (mode=${BUILD_MODE})"
  cd "${APP_ROOT}"
  npm run build
else
  echo "[e2e] Reusing existing frontend build at ${DIST_INDEX} (mode=${BUILD_MODE})"
fi

cd "${APP_ROOT}"

node ./scripts/serve_static_spa.mjs \
  --host "${HOST}" \
  --port "${PORT}" \
  --root "${DIST_INDEX%/index.html}"
