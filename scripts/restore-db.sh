#!/usr/bin/env bash
# restore-db.sh — restore the QLever triplestore from a Turtle backup.
#
# Usage:
#   ./scripts/restore-db.sh <backup-file.ttl>
#
# The script:
#   1. Stops the running qlever container (if any)
#   2. Rebuilds the QLever index from the backup TTL
#   3. Restarts QLever
#
# WARNING: This destroys the current index. Make a backup first.
#
# Requires: docker compose, a .env file at the repo root (for QLEVER_ACCESS_TOKEN)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

BACKUP="${1:-}"
if [[ -z "${BACKUP}" ]]; then
  echo "Usage: $0 <backup-file.ttl>" >&2
  exit 1
fi

if [[ ! -f "${BACKUP}" ]]; then
  echo "Error: backup file not found: ${BACKUP}" >&2
  exit 1
fi

# Resolve to absolute path
BACKUP="$(cd "$(dirname "${BACKUP}")" && pwd)/$(basename "${BACKUP}")"

echo "Restoring QLever from: ${BACKUP}"
echo ""
echo "WARNING: This will DESTROY the current QLever index and rebuild from the backup."
read -r -p "Continue? [y/N] " confirm
if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

cd "${REPO_ROOT}"

# Load env for access token
if [[ -f .env ]]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' .env | grep -v '^$' | xargs)
fi
ACCESS_TOKEN="${QLEVER_ACCESS_TOKEN:-shexmap-dev-token}"

echo ""
echo "1. Stopping qlever container..."
docker compose stop qlever qlever-init 2>/dev/null || true

echo ""
echo "2. Rebuilding index from backup..."
# Run a one-off qlever-init-like container with the backup mounted
docker compose run --rm \
  -v "${BACKUP}:/restore/backup.ttl:ro" \
  --entrypoint /bin/sh \
  qlever-init -c "
    set -e
    cd /data

    echo 'Clearing old index files...'
    rm -f shexmap.index.* shexmap.vocabulary.* shexmap.meta-* shexmap.prefixes merged.ttl 2>/dev/null || true

    echo 'Preparing backup TTL...'
    # Reorder: prefix lines first, then triples (QLever requirement)
    {
      grep '^@prefix' /restore/backup.ttl | sort -u
      echo ''
      grep -v '^@prefix' /restore/backup.ttl | grep -v '^#' | grep -v '^[[:space:]]*$'
    } > merged.ttl

    echo 'Building QLever index...'
    qlever index \
      --name shexmap \
      --input-files merged.ttl \
      --cat-input-files 'cat merged.ttl' \
      --format ttl \
      --parallel-parsing false \
      --system native \
      --overwrite-existing

    echo 'Index rebuild complete.'
  "

echo ""
echo "3. Starting qlever..."
docker compose up -d qlever

echo ""
echo "Waiting for QLever to be ready..."
for i in $(seq 1 20); do
  if curl --silent --fail "http://localhost:7001/sparql?query=ASK%7B%7D" -H "Accept: application/sparql-results+json" > /dev/null 2>&1; then
    echo "QLever is up."
    break
  fi
  sleep 2
  if [[ $i -eq 20 ]]; then
    echo "Warning: QLever did not respond in time — check 'docker compose logs qlever'."
  fi
done

echo ""
echo "Restore complete."
