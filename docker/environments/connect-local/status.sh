#!/bin/bash
# status.sh -- report whether standalone Connect is reachable and a token exists.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Connect-Local Status"
echo "===================="
echo ""

if docker ps --format "{{.Names}}" | grep -q "^connect$"; then
  echo "Container: connect ($(docker ps --format '{{.Status}}' --filter name='^connect$'))"
else
  echo "Container: connect not running (start with: npm run connect:start)"
fi

if curl -fsS "http://localhost:3939/__ping__" >/dev/null 2>&1 || curl -fsS "http://localhost:3939" >/dev/null 2>&1; then
  echo "Reachable: yes (http://localhost:3939)"
else
  echo "Reachable: no"
fi

TOKEN_FILE="${SCRIPT_DIR}/.tokens/connect_bootstrap_token"
if [ -s "$TOKEN_FILE" ]; then
  echo "Token:     present (${TOKEN_FILE})"
else
  echo "Token:     missing (run: npm run connect:start)"
fi
echo ""
