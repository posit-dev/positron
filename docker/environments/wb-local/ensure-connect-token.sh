#!/bin/bash

# ensure-connect-token.sh
#
# Bootstrap (or reuse) a Posit Connect API token and write it to a file.
#
# Extracted from install-workbench.sh so it can be reused by:
#   - the Workbench install flow (sourced; writes to the shared /tokens volume)
#   - the standalone connect-local one-shot bootstrap container (executed;
#     writes to a bind-mounted local file)
#
# Usage (standalone):
#   ensure-connect-token.sh [TOKEN_FILE] [CONNECT_URL]
#
# Defaults:
#   TOKEN_FILE   /tokens/connect_bootstrap_token
#   CONNECT_URL  $CONNECT_URL or http://connect:3939
#
# When sourced, only defines ensure_connect_token (no side effects). The caller
# may provide its own log_error; a fallback is defined here for standalone use.

# Fallback logger for standalone runs. install-workbench.sh defines its own
# log_error (appending to an ERRORS array); when sourced there, that one wins.
if ! declare -F log_error >/dev/null 2>&1; then
  log_error() { echo "ERROR: $1" >&2; }
fi

ensure_connect_token() {
  local token_file="${1:-/tokens/connect_bootstrap_token}"
  local connect_url="${2:-${CONNECT_URL:-http://connect:3939}}"
  local token_dir
  token_dir="$(dirname "$token_file")"
  local tmp_file="${token_dir}/.tmp_token"

  # Reuse if already present
  if [ -s "$token_file" ]; then
    echo "Bootstrap token already present at $token_file"
    export CONNECT_TOKEN="$(cat "$token_file")"
    return 0
  fi

  echo "Waiting for Posit Connect at ${connect_url}..."
  local ok=0
  for i in {1..60}; do
    if curl -fsS "${connect_url}/__ping__" >/dev/null 2>&1 || curl -fsS "${connect_url}" >/dev/null 2>&1; then
      ok=1; break
    fi
    sleep 1
  done
  if [ "$ok" -ne 1 ]; then
    log_error "Connect not reachable at ${connect_url} after 60s"
    return 1
  fi

  echo "Bootstrapping token with rsconnect..."
  umask 077
  mkdir -p "$token_dir"

  # Correct command (no --secret)
  if ! rsconnect bootstrap --server "${connect_url}" --raw > "$tmp_file"; then
    log_error "rsconnect bootstrap failed"
    # optional: print tool version for debugging
    rsconnect --version || true
    return 1
  fi

  # sanity-check non-empty
  if ! [ -s "$tmp_file" ]; then
    log_error "rsconnect returned empty token"
    return 1
  fi

  mv "$tmp_file" "$token_file"
  echo "Wrote bootstrap token to $token_file"
  export CONNECT_TOKEN="$(cat "$token_file")"
}

# Run directly (not sourced): bootstrap using the provided/default arguments.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  ensure_connect_token "$@"
fi
