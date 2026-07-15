#!/usr/bin/env bash
set -euo pipefail
#
# bump-ppm-snapshot.sh <new_date>   (date format: YYYY-MM-DD)
#
# Updates the PPM_SNAPSHOT build arg in the docker-compose files for the OSes
# that pin their build-time R dev-deps install to a *rolling* dated PPM snapshot
# (to dodge the `latest` publish-window 404 race).
#
# debian is INTENTIONALLY EXCLUDED: its PPM_SNAPSHOT is frozen for a different
# reason (bookworm's GDAL can't build terra 1.9), so it must not move with the
# others. Postgres has no R and no PPM_SNAPSHOT.
#
# Fails loudly if any expected file is missing or has no PPM_SNAPSHOT line, so a
# silent partial update can't happen.
#
NEW="${1:?usage: bump-ppm-snapshot.sh <new_date> (YYYY-MM-DD)}"
if ! [[ "$NEW" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "ERROR: date must be YYYY-MM-DD, got: $NEW" >&2
  exit 1
fi
ROOT="$(git rev-parse --show-toplevel)"

# Rolling OSes only -- debian is deliberately NOT in this list.
FILES=(
  docker/images/ubuntu24_04/docker-compose.amd64.yml
  docker/images/ubuntu24_04/docker-compose.arm64.yml
  docker/images/openSUSE15_6/docker-compose.amd64.yml
  docker/images/openSUSE15_6/docker-compose.arm64.yml
  docker/images/SLES15_6/docker-compose.amd64.yml
  docker/images/SLES15_6/docker-compose.arm64.yml
  docker/images/rocky_8/docker-compose.amd64.yml
  docker/images/rocky_8/docker-compose.arm64.yml
)

changed=0
for f in "${FILES[@]}"; do
  p="$ROOT/$f"
  [[ -f "$p" ]] || { echo "ERROR: expected file missing: $f" >&2; exit 1; }
  grep -qE '^[[:space:]]*PPM_SNAPSHOT:' "$p" || { echo "ERROR: no PPM_SNAPSHOT line in $f" >&2; exit 1; }
  # Preserve leading indentation; replace only the value. Keep it quoted so YAML
  # treats the date as a string, not a timestamp (buildx bake rejects time.Time).
  sed -i.bak -E "s/^([[:space:]]*PPM_SNAPSHOT:[[:space:]]*).*/\1\"${NEW}\"/" "$p"
  rm -f "$p.bak"
  changed=$((changed + 1))
done

echo "Updated PPM_SNAPSHOT to ${NEW} in ${changed} files (debian intentionally left frozen):"
grep -nE '^[[:space:]]*PPM_SNAPSHOT:' "${FILES[@]/#/$ROOT/}"
