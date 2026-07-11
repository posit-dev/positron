#!/bin/bash
# token.sh -- print the current local Connect publisher token path and value.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOKEN_FILE="${SCRIPT_DIR}/.tokens/connect_bootstrap_token"

if [ -s "$TOKEN_FILE" ]; then
  echo "Token file: ${TOKEN_FILE}"
  echo "Token:      $(cat "$TOKEN_FILE")"
else
  echo "No token found at ${TOKEN_FILE}. Run: npm run connect:start" >&2
  exit 1
fi
