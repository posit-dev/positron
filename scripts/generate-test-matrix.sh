#!/usr/bin/env bash
#
# Generate a JSON matrix for GitHub Actions based on the number of shards.
# Usage: ./scripts/generate-test-matrix.sh <num_shards>
#
# Outputs: {"shard":[1,2,3,...,n]}

set -euo pipefail

shards="${1:-1}"

if [ -z "$shards" ] || [ "$shards" -le 1 ]; then
  echo '{"shard":[1]}'
else
  # Generate array with proper JSON formatting (no trailing comma)
  list=$(seq 1 "$shards" | paste -sd, -)
  echo "{\"shard\":[${list}]}"
fi
