#!/usr/bin/env bash
# Force a full QLever index rebuild from current seed/ontology files.
# WARNING: Stops the qlever service, wipes the index volume, and rebuilds.
# Usage: ./scripts/rebuild-index.sh

set -e
COMPOSE_FILE="$(dirname "$0")/../docker-compose.yml"
SPARQL_DIR="$(cd "$(dirname "$0")/.." && pwd)/sparql"

echo "Stopping qlever service..."
docker compose -f "$COMPOSE_FILE" stop qlever

echo "Clearing QLever data volume..."
docker run --rm \
  -v shexmap-repository_qlever-data:/data \
  alpine sh -c "rm -rf /data/* && chmod 777 /data && chown -R 999:999 /data"

echo "Rebuilding index from seed files..."
docker run --rm \
  -v shexmap-repository_qlever-data:/data \
  -v "${SPARQL_DIR}:/sparql-data:ro" \
  -v "$(cd "$(dirname "$0")/.." && pwd)/docker/qlever:/scripts:ro" \
  --user root \
  --entrypoint sh \
  adfreiburg/qlever:latest \
  -c "
    chmod 777 /data && chown 999:999 /data
    cd /data
    rm -f ./*.ttl
    cp /sparql-data/ontology/*.ttl .
    cp /sparql-data/seed/shexmaps/*.ttl . 2>/dev/null || true
    cp /sparql-data/seed/pairings/*.ttl . 2>/dev/null || true
    cp /sparql-data/seed/*.ttl . 2>/dev/null || true
    { grep -h '^@prefix' ./*.ttl | sort -u; echo ''; grep -hv '^@prefix' ./*.ttl | grep -v '^#' | grep -v '^[[:space:]]*$'; } > merged.ttl
    chown -R 999:999 /data
    echo '{}' > settings.json
    su qlever -s /bin/sh -c 'cd /data && cat merged.ttl | /qlever/qlever-index -i shexmap -s settings.json --vocabulary-type on-disk-compressed -F ttl -f - -p false'
  "

echo "Starting qlever..."
docker compose -f "$COMPOSE_FILE" start qlever

echo "Index rebuild complete."
