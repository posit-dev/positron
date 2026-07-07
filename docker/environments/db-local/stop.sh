#!/bin/sh
# stop.sh - Stop and completely remove the standalone Postgres database,
# including its container, network, and named volume (all data is destroyed).

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"

# Compose project name heuristic:
# - Use COMPOSE_PROJECT_NAME if set, else the directory name.
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "${SCRIPT_DIR}")}"

echo "Stopping and removing the database (containers, networks, and named volumes)..."
docker compose -f "${COMPOSE_FILE}" down -v --remove-orphans

# Safety net: explicitly remove any lingering volumes we know about.
# Compose usually names them as <project>_<volume>.
for VOL in postgres-data; do
  for NAME in "$VOL" "${PROJECT_NAME}_${VOL}"; do
    if docker volume inspect "$NAME" >/dev/null 2>&1; then
      echo "Removing lingering volume: $NAME"
      docker volume rm -f "$NAME" >/dev/null || true
    fi
  done
done

echo "Done."
