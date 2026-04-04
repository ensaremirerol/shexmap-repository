#!/usr/bin/env bash
# backup-db.sh — dump the QLever triplestore to a Turtle file.
#
# Usage:
#   ./scripts/backup-db.sh [output-file]
#
# If no output file is given, writes to:
#   sparql/backup/YYYY-MM-DDTHH-MM-SS.ttl
#
# Requires: curl, a running QLever instance (default: http://localhost:7001)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

QLEVER_URL="${QLEVER_SPARQL_URL:-http://localhost:7001/sparql}"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H-%M-%S")"
DEFAULT_OUT="${REPO_ROOT}/sparql/backup/${TIMESTAMP}.ttl"
OUT="${1:-${DEFAULT_OUT}}"

mkdir -p "$(dirname "${OUT}")"

echo "Backing up QLever triplestore..."
echo "  endpoint : ${QLEVER_URL}"
echo "  output   : ${OUT}"

# SPARQL CONSTRUCT dumps every triple in the default graph
curl --fail --silent --show-error \
  -G "${QLEVER_URL}" \
  --data-urlencode "query=CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }" \
  -H "Accept: text/turtle" \
  -o "${OUT}"

LINES=$(wc -l < "${OUT}")
echo "Done — ${LINES} lines written to ${OUT}"
