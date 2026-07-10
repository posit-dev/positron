#!/bin/bash
# run.sh -- bring up standalone Posit Connect and bootstrap a publisher token.
#
# 1. Starts the `connect` service (persistent connect-data volume).
# 2. Runs the one-shot `token` service to bootstrap/reuse the Connect API token,
#    writing it to ./.tokens/connect_bootstrap_token (read by the test resolver).
#
# See README.md for prerequisites (/etc/hosts entry, connect.lic, ghcr login).

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
COMPOSE_FILE="docker-compose.yml"

# Load environment variables from .env if present.
if [ -f .env ]; then
  echo "Loading environment variables from .env file..."
  set -a
  # shellcheck source=/dev/null
  . ./.env
  set +a
fi

# Connect requires a valid base64 Bootstrap.SecretKey. Mint one the first time
# and persist it to .env so it stays stable across runs (rebootstrapping is a
# no-op once the token file exists, so a stable key avoids churn).
if [ -z "${CONNECT_BOOTSTRAP_SECRETKEY:-}" ]; then
  CONNECT_BOOTSTRAP_SECRETKEY="$(openssl rand -base64 32)"
  export CONNECT_BOOTSTRAP_SECRETKEY
  printf '\nCONNECT_BOOTSTRAP_SECRETKEY="%s"\n' "$CONNECT_BOOTSTRAP_SECRETKEY" >> .env
  echo "Generated CONNECT_BOOTSTRAP_SECRETKEY (saved to .env)"
fi

# A prior run without a license lets the bind-mount auto-create connect/connect.lic
# as a *directory*, which then breaks connect startup and the copy below. Clear it.
if [ -d "connect/connect.lic" ]; then
  rm -rf "connect/connect.lic"
fi

# Source a Connect license if one isn't already in place: prefer a connect.lic in
# this dir, else reuse the wb-local one (shared local-dev license).
if [ ! -f "connect/connect.lic" ]; then
  if [ -f "connect.lic" ]; then
    cp "connect.lic" "connect/connect.lic"
  elif [ -f "../wb-local/connect/connect.lic" ]; then
    cp "../wb-local/connect/connect.lic" "connect/connect.lic"
    echo "Reused Connect license from ../wb-local/connect/connect.lic"
  fi
fi
if [ ! -f "connect/connect.lic" ]; then
  echo "WARNING: no Connect license at connect/connect.lic -- connect will not become" >&2
  echo "         healthy. Add connect/connect.lic (see README.md)." >&2
fi

echo "Starting Posit Connect..."
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans connect

echo "Waiting for Connect to become healthy..."
tries=0
until curl -fsS "http://localhost:3939/__ping__" >/dev/null 2>&1 || curl -fsS "http://localhost:3939" >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -ge 120 ]; then
    echo "Timed out waiting for Connect on http://localhost:3939." >&2
    echo "Check logs: docker compose -f ${COMPOSE_FILE} logs connect" >&2
    exit 1
  fi
  sleep 1
done

echo "Bootstrapping Connect API token (one-shot)..."
docker compose -f "$COMPOSE_FILE" run --rm token

TOKEN_FILE="${SCRIPT_DIR}/.tokens/connect_bootstrap_token"
echo ""
if [ -s "$TOKEN_FILE" ]; then
  echo "Connect is up. Token written to: ${TOKEN_FILE}"
else
  echo "WARNING: token file missing/empty at ${TOKEN_FILE}." >&2
fi
echo ""
echo "Reminder: add '127.0.0.1 connect' to /etc/hosts so the publisher's stored"
echo "          'connect:3939' credential resolves on the host."
echo ""
echo "Run the tests with:"
echo "  npx playwright test --project e2e-connect test/e2e/tests/connect/"
echo ""
