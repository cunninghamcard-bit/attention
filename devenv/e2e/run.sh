#!/bin/bash
# Server-form acceptance runner: compose PG → migrate → attentiond → the
# official-client e2e. Exits non-zero unless SYNC_E2E_PASS.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"

export DATABASE_URL="${DATABASE_URL:-postgres://attention:attention@127.0.0.1:5433/attention?sslmode=disable}"
export ATTENTIOND_ADDR="${ATTENTIOND_ADDR:-127.0.0.1:8788}"
export ATTENTIOND_JWT_SECRET="${ATTENTIOND_JWT_SECRET:-e2e-secret}"
export SERVER_URL="http://${ATTENTIOND_ADDR}"

docker compose -f "$ROOT/devenv/docker-compose.yml" up -d
for _ in $(seq 1 30); do
  docker exec attention-postgres pg_isready -U attention >/dev/null 2>&1 && break
  sleep 1
done

(cd "$ROOT" && go build -o /tmp/attentiond ./cmd/attentiond)
/tmp/attentiond migrate up
/tmp/attentiond serve &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do
  curl -sf "$SERVER_URL/health" >/dev/null 2>&1 && break
  sleep 0.3
done

[ -d node_modules ] || npm install --no-audit --no-fund
node sync.e2e.mjs
