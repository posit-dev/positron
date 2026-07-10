#!/bin/bash
# stop-containers.sh -- stop the standalone Connect stack.
#
# By default the persistent connect-data volume is KEPT (so the bootstrap key --
# and any saved publisher keychain credential -- stays valid on the next run).
# Pass --wipe to remove the volume and the local token file for a clean slate;
# the next run.sh will re-bootstrap a fresh token (the test's local self-heal
# then clears the stale keychain credential automatically).

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
COMPOSE_FILE="docker-compose.yml"

WIPE=false
if [ "${1:-}" = "--wipe" ] || [ "${1:-}" = "-v" ]; then
  WIPE=true
elif [ -n "${1:-}" ]; then
  echo "Usage: $0 [--wipe]"
  exit 1
fi

if [ "$WIPE" = true ]; then
  echo "Stopping Connect and removing the connect-data volume..."
  docker compose -f "$COMPOSE_FILE" --profile token down -v --remove-orphans
  rm -f "${SCRIPT_DIR}/.tokens/connect_bootstrap_token" "${SCRIPT_DIR}/.tokens/.last_publisher_key"
  echo "Wiped. Next run.sh will re-bootstrap a fresh token."
else
  echo "Stopping Connect (volumes preserved)..."
  docker compose -f "$COMPOSE_FILE" --profile token down --remove-orphans
  echo "Stopped. Data preserved; resume with: npm run connect:start"
fi
