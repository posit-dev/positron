#!/bin/sh
# stop-containers.sh - Stop and remove Docker Compose stack AND volumes

set -eu

# Default OS (accepts optional 1st arg: ubuntu24|rocky8)
OS_TYPE="ubuntu24"
if [ "${1:-}" = "ubuntu24" ] || [ "${1:-}" = "rocky8" ]; then
  OS_TYPE="$1"
elif [ -n "${1:-}" ]; then
  echo "Usage: $0 [ubuntu24|rocky8]"
  echo "       Default is ubuntu24 if not specified"
  echo ""
fi

COMPOSE_FILE="docker-compose.${OS_TYPE}.yml"

# Compose project name heuristic:
# - Use COMPOSE_PROJECT_NAME if set, else current directory name
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$(pwd)")}"

echo "Stopping and removing containers, networks, and named volumes (${OS_TYPE})..."
echo "Using compose file: ${COMPOSE_FILE}"
docker compose -f "${COMPOSE_FILE}" down -v --remove-orphans
echo "Compose stack removed (including volumes)."

# Safety net: explicitly remove any lingering volumes we know about.
# Compose usually names them as <project>_<volume>.
# If someone changed project names between runs, this clears both forms.
for VOL in connect_tokens postgres-data connect-data; do
  for NAME in "$VOL" "${PROJECT_NAME}_${VOL}"; do
    if docker volume inspect "$NAME" >/dev/null 2>&1; then
      echo "Removing lingering volume: $NAME"
      docker volume rm -f "$NAME" >/dev/null || true
    fi
  done
done

echo "Done."
