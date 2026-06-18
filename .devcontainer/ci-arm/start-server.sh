#!/usr/bin/env bash
# Start the Positron e2e server in the browser, licensed.
#
# Server/hosted mode needs a POSITRON_LICENSE_KEY (distinct from the pdol_rsa signing key the
# e2e-electron tests use). We issue one with the pdol binary baked into the CI image — the same
# thing scripts/code-server.js does for local dev — then hand off to scripts/e2e-start-server.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOKEN="${1:-dev-token}"
PORT="${2:-8080}"
PDOL=/positron-license/pdol/target/debug/pdol

if [ -x "$PDOL" ]; then
  POSITRON_LICENSE_KEY="$("$PDOL" --connection-token "$TOKEN")"
  export POSITRON_LICENSE_KEY
  echo "Issued a Positron license key for token '$TOKEN'."
else
  echo "WARNING: license issuer not found at $PDOL — the server will be unlicensed."
fi

cd "$ROOT"
echo "Server will be at http://localhost:${PORT}/?tkn=${TOKEN}"
exec ./scripts/e2e-start-server.sh "$PORT" "$TOKEN" "$HOME/.positron-e2e-test" 0.0.0.0
