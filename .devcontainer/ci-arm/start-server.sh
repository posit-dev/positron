#!/usr/bin/env bash
# Start the Positron web server (browser-accessible), licensed, and print a clickable URL.
#
# Like the Desktop launcher, this detaches the server (logs to a file) and prints the URL only once
# the port is actually accepting connections — so it's click-and-go and re-running restarts cleanly.
#
# Server/hosted mode needs a POSITRON_LICENSE_KEY (distinct from the pdol_rsa signing key the
# e2e-electron tests use). We issue one with the pdol binary baked into the CI image — the same
# thing scripts/code-server.js does for local dev — then hand off to scripts/e2e-start-server.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOKEN="${1:-dev-token}"
PORT="${2:-8080}"
PDOL=/positron-license/pdol/target/debug/pdol
USER_DATA="$HOME/.positron-e2e-test"
LOG=/tmp/positron-server.log
ERR=/tmp/positron-server.err  # the Doctor reads this to flag a failed start; cleared on success
fail() { echo "$1" >"$ERR"; echo "$1"; exit 1; }

# The server needs the compiled server entry. If post-create is still building, fail friendly.
if [ ! -f "$ROOT/out/server-main.js" ]; then
  echo "Positron isn't built yet — out/server-main.js is missing (the cold build / post-create may"
  echo "still be running). Wait until the 'Doctor' reports the build is current, then try again."
  fail "not built — run 'Positron CI: Rebuild'"
fi

if [ -x "$PDOL" ]; then
  POSITRON_LICENSE_KEY="$("$PDOL" --connection-token "$TOKEN")"
  export POSITRON_LICENSE_KEY
  echo "Issued a Positron license key for token '$TOKEN'."
else
  echo "WARNING: license issuer not found at $PDOL — the server will be unlicensed."
fi

# Clear any server we previously started on this port so re-running is a clean restart (otherwise
# the new one can't bind the port). The "--port $PORT" match targets our server only, not the
# dev-container's own remote server (which runs on a different port).
pkill -f "out/server-main.js.*--port $PORT" 2>/dev/null || true
sleep 1
pkill -9 -f "out/server-main.js.*--port $PORT" 2>/dev/null || true

cd "$ROOT"
# e2e-start-server.sh runs the server in the foreground (streams logs, never returns). Detach it
# with logs to a file so they don't bury the URL; setsid keeps it alive after this task ends.
setsid ./scripts/e2e-start-server.sh "$PORT" "$TOKEN" "$USER_DATA" 0.0.0.0 \
  >"$LOG" 2>&1 </dev/null &

# Wait until the server is actually accepting connections, then print the clickable URL at the end.
URL="http://localhost:${PORT}/?tkn=${TOKEN}"
echo "Positron server is starting (logs: $LOG)..."
for _ in $(seq 1 60); do
  if (exec 3<>"/dev/tcp/localhost/$PORT") 2>/dev/null; then
    # The subshell above opens and closes FD 3 itself; we only use its exit code. (No FD to close
    # in this shell - `exec 3>&- 3<&-` here printed "bash: 3: Bad file descriptor" on every start.)
    rm -f "$ERR"
    echo ""
    echo "Positron server is up — Cmd-click to open it in your browser:"
    echo ""
    echo "    $URL"
    echo ""
    exit 0
  fi
  sleep 1
done

fail "didn't come up in 60s — check /tmp/positron-server.log"
