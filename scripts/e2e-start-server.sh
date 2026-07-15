#!/bin/bash

# Start the Positron code server for external e2e testing
# Usage: ./scripts/start-e2e-server.sh [port] [token] [user-data-dir] [host]
#
# host defaults to 127.0.0.1. Pass 0.0.0.0 when the server needs to be
# reachable from outside the machine (e.g. inside a Docker container with
# port forwarding).

PORT=${1:-8080}
TOKEN=${2:-dev-token}
USER_DATA_DIR=${3:-"$HOME/.positron-e2e-test"}
HOST=${4:-127.0.0.1}

echo "Starting Positron code server for e2e testing..."
echo "Host: $HOST"
echo "Port: $PORT"
echo "Token: $TOKEN"
echo "User Data Dir: $USER_DATA_DIR"
echo "URL: http://localhost:$PORT/?tkn=$TOKEN"
echo ""

# Note: User data directory creation, fixture copying, and cleanup
# are handled by the test fixture system.

# Start the server with additional e2e options
./scripts/code-server.sh --no-launch --host "$HOST" --connection-token "$TOKEN" --port "$PORT" \
	--user-data-dir "$USER_DATA_DIR" \
	--disable-telemetry \
	--disable-experiments \
	--skip-welcome \
	--skip-release-notes \
	--no-cached-data \
	--disable-updates \
	--use-inmemory-secretstorage \
	--disable-workspace-trust
