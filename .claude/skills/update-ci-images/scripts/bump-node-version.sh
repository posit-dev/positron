#!/usr/bin/env bash
set -euo pipefail
#
# bump-node-version.sh <new_node_version>
#
# Updates the NODE_VERSION build arg in every OS docker-compose file.
# The postgres image has no NODE_VERSION (it is just postgres:latest), so it
# is intentionally excluded. Fails loudly if any expected file is missing or
# has no NODE_VERSION line, so a silent partial update can't happen.
#
NEW="${1:?usage: bump-node-version.sh <new_node_version>}"
ROOT="$(git rev-parse --show-toplevel)"

FILES=(
  docker/images/ubuntu24_04/docker-compose.amd64.yml
  docker/images/ubuntu24_04/docker-compose.arm64.yml
  docker/images/rocky_8/docker-compose.amd64.yml
  docker/images/rocky_8/docker-compose.arm64.yml
  docker/images/debian/docker-compose.amd64.yml
  docker/images/debian/docker-compose.arm64.yml
  docker/images/openSUSE15_6/docker-compose.amd64.yml
  docker/images/openSUSE15_6/docker-compose.arm64.yml
  docker/images/SLES15_6/docker-compose.amd64.yml
  docker/images/SLES15_6/docker-compose.arm64.yml
)

changed=0
for f in "${FILES[@]}"; do
  p="$ROOT/$f"
  [[ -f "$p" ]] || { echo "ERROR: expected file missing: $f" >&2; exit 1; }
  grep -qE '^[[:space:]]*NODE_VERSION:' "$p" || { echo "ERROR: no NODE_VERSION line in $f" >&2; exit 1; }
  # Preserve leading indentation; replace only the value.
  sed -i.bak -E "s/^([[:space:]]*NODE_VERSION:[[:space:]]*).*/\1${NEW}/" "$p"
  rm -f "$p.bak"
  changed=$((changed + 1))
done

echo "Updated NODE_VERSION to ${NEW} in ${changed} files:"
grep -nE '^[[:space:]]*NODE_VERSION:' "${FILES[@]/#/$ROOT/}"
