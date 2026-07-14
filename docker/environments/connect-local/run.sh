#!/bin/bash
# run.sh -- bring up a clean standalone Posit Connect and bootstrap a token.
#
# Connect is treated as an ephemeral test dependency: every start begins from a
# clean slate. This avoids the stale-state failure modes that persistence
# invites (a saved token outliving the data it belonged to).
#
# 1. Tears down any prior stack + connect-data volume + saved token.
# 2. Starts a fresh `connect` service.
# 3. Runs the one-shot `token` service to bootstrap a fresh Connect API token,
#    writing it to ./.tokens/connect_bootstrap_token (read by the test resolver).
#
# The `.tokens/.last_publisher_key` marker is deliberately preserved so the
# publisher tests' keychain self-heal can detect that the (fresh) key rotated
# and re-enter their saved credential.
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
# and persist it to .env so it stays stable across runs. (The secret key stays
# stable; the API key it bootstraps is minted fresh on every start.)
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

# Clean slate: remove any prior stack, its connect-data volume, and the saved
# token so this start is fully reproducible. The .last_publisher_key marker is
# intentionally NOT removed (see header).
echo "Removing any prior Connect stack for a clean start..."
docker compose -f "$COMPOSE_FILE" --profile token down -v --remove-orphans
rm -f "${SCRIPT_DIR}/.tokens/connect_bootstrap_token"

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

TOKEN_FILE="${SCRIPT_DIR}/.tokens/connect_bootstrap_token"

echo "Bootstrapping Connect API token (one-shot)..."
docker compose -f "$COMPOSE_FILE" run --rm token

echo ""
# Presence check only: the one-shot token container runs as root, so the token
# file is root-owned (mode 600) on Linux/CI and this script (non-root) can't read
# its contents -- but `test -s` only stats the file, so it works regardless of
# ownership. Callers that need the value read it with sudo (see the CI workflow).
# Since the data dir was just wiped, bootstrap runs against a fresh instance and
# should always produce a token; auth itself is validated by the tests.
if [ -s "$TOKEN_FILE" ]; then
  echo "Connect is up. Token written to: ${TOKEN_FILE}"
else
  echo "ERROR: token was not bootstrapped at ${TOKEN_FILE}." >&2
  echo "       Check the connect logs: docker compose -f ${COMPOSE_FILE} logs connect" >&2
  exit 1
fi
echo ""
echo "Reminder: add '127.0.0.1 connect' to /etc/hosts so the publisher's stored"
echo "          'connect:3939' credential resolves on the host."
echo ""
echo "Run the tests with:"
echo "  npx playwright test --project e2e-connect test/e2e/tests/connect/"
echo ""
