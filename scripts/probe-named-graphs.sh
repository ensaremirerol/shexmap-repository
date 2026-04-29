#!/usr/bin/env bash
# Spike: verify QLever supports SPARQL 1.1 Update on named graphs.
# Run from any host with `docker compose` available — exec'd into the QLever container.
#
# Outcomes:
#   1) All four steps green → use a single ACL named graph (Option B).
#   2) Step 2 returns the triple via {?s ?p ?o} but step 3 ASKs return true
#      → QLever flattened to default graph; fall back to mixed-graph ACL (Option A).
#   3) Step 1 fails → no named-graph UPDATE; rebuild seed pipeline or use Option A.
set -e

CONTAINER="${QLEVER_CONTAINER:-shexmap-repository-qlever-1}"
TOKEN="${QLEVER_ACCESS_TOKEN:-shexmap-dev-token}"
SPARQL_URL="${SPARQL_URL:-http://localhost:7001}"
GRAPH="https://w3id.org/shexmap/acl-probe"
SUBJECT="https://example.org/map/probe"
PRED="https://w3id.org/shexmap/editableBy"
OBJECT="https://example.org/user/probe"

run() {
  docker exec "$CONTAINER" curl --fail-with-body -sS "$@" 2>&1
}

hr() { printf '\n──── %s ────\n' "$1"; }

hr "1. INSERT DATA into named graph <$GRAPH>"
run -X POST "$SPARQL_URL/" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/sparql-update" \
  --data "INSERT DATA { GRAPH <$GRAPH> { <$SUBJECT> <$PRED> <$OBJECT> . } }" \
  || { echo "→ INSERT failed; named graph UPDATE not supported"; exit 10; }
echo

hr "2. SELECT from the named graph (must return the triple)"
run -X POST "$SPARQL_URL/" \
  -H "Accept: application/sparql-results+json" \
  --data-urlencode "query=SELECT ?s ?p ?o WHERE { GRAPH <$GRAPH> { ?s ?p ?o } }"
echo

hr "3. ASK whether triple is in the DEFAULT graph (must be false for true isolation)"
run -X POST "$SPARQL_URL/" \
  -H "Accept: application/sparql-results+json" \
  --data-urlencode "query=ASK { <$SUBJECT> ?p ?o }"
echo

hr "4. SELECT all named graphs (sanity check)"
run -X POST "$SPARQL_URL/" \
  -H "Accept: application/sparql-results+json" \
  --data-urlencode "query=SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } }"
echo

hr "5. Cleanup: DROP GRAPH <$GRAPH>"
run -X POST "$SPARQL_URL/" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/sparql-update" \
  --data "DROP GRAPH <$GRAPH>" \
  || echo "(DROP failed — manual cleanup may be needed)"
echo

echo "── Done ──"
