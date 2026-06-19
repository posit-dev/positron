#!/usr/bin/env bash
# Start the Positron web server (browser-accessible), licensed.
#
# Server/hosted mode needs a POSITRON_LICENSE_KEY (distinct from the pdol_rsa signing key the
# e2e-electron tests use). We issue one with the pdol binary baked into the CI image — the same
# thing scripts/code-server.js does for local dev — then hand off to scripts/e2e-start-server.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOKEN="${1:-dev-token}"
PORT="${2:-8080}"
PDOL=/positron-license/pdol/target/debug/pdol

# The server needs the compiled server entry. If post-create is still building, fail friendly.
if [ ! -f "$ROOT/out/server-main.js" ]; then
  echo "Positron isn't built yet — out/server-main.js is missing (the cold build / post-create may"
  echo "still be running). Wait until the 'Doctor' reports the build is current, then try again."
  exit 1
fi

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
