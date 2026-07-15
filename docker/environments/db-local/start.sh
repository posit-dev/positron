#!/bin/sh
# start.sh - Start the standalone Postgres database for local browsing.
# The database comes up on its own (no test container) and seeds the
# 'periodic' and 'dvdrental' sample databases on first run.

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"

DB_USER="${E2E_POSTGRES_USER:-testuser}"

echo "Starting Postgres database..."
docker compose -f "${COMPOSE_FILE}" up -d

echo ""
echo "Waiting for database to be ready..."
for i in $(seq 1 30); do
  if docker exec postgres-db pg_isready -U "${DB_USER}" -d postgres >/dev/null 2>&1; then
    echo "Database is ready."
    echo ""
    echo "Databases: periodic, dvdrental"
    echo "Connect:   psql -h localhost -p 5432 -U ${DB_USER} -d dvdrental"
    echo "Stop:      npm run db:stop"
    exit 0
  fi
  sleep 1
done

echo "Database did not report ready in time. Check logs with:"
echo "  docker logs postgres-db"
exit 1
