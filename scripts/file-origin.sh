#!/usr/bin/env bash
#
# Determines the origin of a source file.
# Outputs: "upstream" (vscode), "positron", or "unknown"
#
# Usage: ./scripts/file-origin.sh <file>
#
set -e

file="$1"

if [ -z "$file" ]; then
	echo "Usage: $0 <file>"
	exit 1
fi

if [ ! -f "$file" ]; then
	echo "unknown"
	exit 0
fi

header=$(head -20 "$file")
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
relpath="${file#$REPO_ROOT/}"

if echo "$header" | grep -qi "Copyright.*Posit" ||
   echo "$relpath" | grep -qi "positron"; then
	echo "positron"
elif echo "$header" | grep -qi "Copyright.*Microsoft"; then
	echo "upstream"
else
	echo "unknown"
fi
