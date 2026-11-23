#!/usr/bin/env bash
set -euo pipefail
#
# retag-consumers.sh <old_tag> <new_tag> [--builds <positron-builds checkout>]
#
# Repoints every consumer of the published images from
# ghcr.io/posit-dev/positron-<os>:<old_tag> to <new_tag>. Without --builds the
# consumers are this repository's (local compose stacks, the ci-arm
# devcontainer, the wb-local lib and its test, the memory publish test). With
# --builds they are the lane workflows and dev/ in that checkout, which is
# where the test lanes run. Run it once each way.
# Historical notes in ROCKY-PLAN.md are left alone on purpose.
#
OLD="${1:?usage: retag-consumers.sh <old_tag> <new_tag>}"
NEW="${2:?missing new tag}"
if [[ "${3:-}" == "--builds" ]]; then
  ROOT="$(git -C "${4:?--builds needs the path of a positron-builds checkout}" rev-parse --show-toplevel)"
  DIRS=(.github dev)
  LEFTOVER_DIRS=(.github dev)
else
  ROOT="$(git rev-parse --show-toplevel)"
  DIRS=(.github docker/environments .devcontainer scripts/test test/e2e)
  LEFTOVER_DIRS=(.github docker .devcontainer scripts test/e2e)
fi
cd "$ROOT"
# A tag ends at the first character that cannot be part of a tag, so an old
# tag that is a prefix of the new one (24.18.0 vs 24.18.0-py...) is not
# matched twice.
MATCH="ghcr\\.io/posit-dev/positron-[a-z0-9]+:\\Q${OLD}\\E(?![A-Za-z0-9._-])"

mapfile -t FILES < <(grep -rlF ":${OLD}" "${DIRS[@]}" | grep -v 'ROCKY-PLAN.md' | sort)

changed=0
for p in "${FILES[@]}"; do
  n="$(perl -ne "print if m{${MATCH}}" "$p" | wc -l | tr -d ' ')"
  [[ "$n" -gt 0 ]] || continue
  perl -pi -e "s#(ghcr\\.io/posit-dev/positron-[a-z0-9]+:)\\Q${OLD}\\E(?![A-Za-z0-9._-])#\${1}${NEW}#g" "$p"
  printf '%-64s %s ref(s)\n' "$p" "$n"
  changed=$((changed + 1))
done
[[ "$changed" -gt 0 ]] || { echo "ERROR: no consumer references :${OLD}" >&2; exit 1; }

echo
echo "Leftover references to :${OLD} (expected: historical notes only):"
grep -rnF ":${OLD}" "${LEFTOVER_DIRS[@]}" \
  | perl -ne "print if m{${MATCH}}" || echo "(none)"
