#!/bin/bash

# Start the Positron code server for external e2e testing
# Usage: ./scripts/start-e2e-server.sh [port] [token]

PORT=${1:-8080}
TOKEN=${2:-dev-token}

echo "Starting Positron code server for e2e testing..."
echo "Port: $PORT"
echo "Token: $TOKEN"
echo "URL: http://localhost:$PORT/?tkn=$TOKEN"
echo ""

# Start the server
./scripts/code-server.sh --no-launch --connection-token "$TOKEN" --port "$PORT"
