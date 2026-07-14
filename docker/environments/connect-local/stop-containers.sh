#!/bin/bash
# stop-containers.sh -- tear down the standalone Connect stack.
#
# Connect is an ephemeral test dependency (see run.sh): there is no state worth
# keeping between runs, so stopping removes the container, the connect-data
# volume, and the saved bootstrap token. The next `run.sh` bootstraps a fresh
# token against a fresh instance.
#
# The `.tokens/.last_publisher_key` marker is deliberately preserved so the
# publisher tests' keychain self-heal can still detect that the key rotated on
# the next run and re-enter their saved credential.

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
COMPOSE_FILE="docker-compose.yml"

# Accept (and ignore) the historical --wipe/-v flag: a full wipe is now the
# default, so these are no-ops kept for backward compatibility.
if [ -n "${1:-}" ] && [ "${1:-}" != "--wipe" ] && [ "${1:-}" != "-v" ]; then
  echo "Usage: $0 [--wipe]"
  exit 1
fi

echo "Stopping Connect and removing the connect-data volume..."
docker compose -f "$COMPOSE_FILE" --profile token down -v --remove-orphans
rm -f "${SCRIPT_DIR}/.tokens/connect_bootstrap_token"
echo "Stopped. Start a fresh instance with: npm run connect:start"
