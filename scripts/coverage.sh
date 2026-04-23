#!/usr/bin/env bash
# Run test coverage for every service that has a test:coverage script.
# Usage: ./scripts/coverage.sh
#        ./scripts/coverage.sh svc-validate svc-auth   # specific services only

set -euo pipefail

SERVICES_DIR="$(cd "$(dirname "$0")/../services" && pwd)"
PASS=0
FAIL=0
SKIP=0
FAILED_SVCS=()

# Determine which services to check
if [ $# -gt 0 ]; then
  TARGETS=("$@")
else
  TARGETS=()
  for d in "$SERVICES_DIR"/svc-*/; do
    TARGETS+=("$(basename "$d")")
  done
fi

for svc in "${TARGETS[@]}"; do
  svc_dir="$SERVICES_DIR/$svc"

  if [ ! -f "$svc_dir/package.json" ]; then
    echo "⚠  $svc — no package.json, skipping"
    ((SKIP++)) || true
    continue
  fi

  if ! node -e "const p=require('$svc_dir/package.json'); process.exit(p.scripts?.['test:coverage'] ? 0 : 1)" 2>/dev/null; then
    echo "⚠  $svc — no test:coverage script, skipping"
    ((SKIP++)) || true
    continue
  fi

  echo ""
  echo "══════════════════════════════════════"
  echo "  $svc"
  echo "══════════════════════════════════════"

  if (cd "$svc_dir" && npm run test:coverage --silent 2>&1); then
    ((PASS++)) || true
  else
    echo "✗  $svc FAILED"
    ((FAIL++)) || true
    FAILED_SVCS+=("$svc")
  fi
done

echo ""
echo "══════════════════════════════════════"
echo "  Summary"
echo "══════════════════════════════════════"
echo "  Passed : $PASS"
echo "  Failed : $FAIL"
echo "  Skipped: $SKIP"

if [ ${#FAILED_SVCS[@]} -gt 0 ]; then
  echo ""
  echo "Failed services:"
  for svc in "${FAILED_SVCS[@]}"; do
    echo "  - $svc"
  done
  exit 1
fi
