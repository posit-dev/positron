#!/usr/bin/env bash
# canvas-lab: see README.md next to this script. Runs the TypeScript entry point with tsx.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$DIR/../../../../node_modules/.bin/tsx" "$DIR/canvasLab.ts" "$@"
