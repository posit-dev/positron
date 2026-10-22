#!/usr/bin/env bash
set -euo pipefail
#
# retag-consumers.sh <old_tag> <new_tag>
#
# Repoints every consumer of the published images (workflows, local compose
# stacks, the ci-arm devcontainer, the wb-local lib and its test, the memory
# publish test) from ghcr.io/posit-dev/positron-<os>:<old_tag> to <new_tag>.
# Historical notes in ROCKY-PLAN.md are left alone on purpose.
#
OLD="${1:?usage: retag-consumers.sh <old_tag> <new_tag>}"
NEW="${2:?missing new tag}"
ROOT="$(git rev-parse --show-toplevel)"
# A tag ends at the first character that cannot be part of a tag, so an old
# tag that is a prefix of the new one (24.18.0 vs 24.18.0-py...) is not
# matched twice.
MATCH="ghcr\\.io/posit-dev/positron-[a-z0-9]+:\\Q${OLD}\\E(?![A-Za-z0-9._-])"

mapfile -t FILES < <(grep -rlF ":${OLD}" "$ROOT/.github" "$ROOT/docker/environments" "$ROOT/.devcontainer" "$ROOT/scripts/test" "$ROOT/test/e2e" \
  | grep -v 'ROCKY-PLAN.md' | sort)

changed=0
for p in "${FILES[@]}"; do
  n="$(perl -ne "print if m{${MATCH}}" "$p" | wc -l | tr -d ' ')"
  [[ "$n" -gt 0 ]] || continue
  perl -pi -e "s#(ghcr\\.io/posit-dev/positron-[a-z0-9]+:)\\Q${OLD}\\E(?![A-Za-z0-9._-])#\${1}${NEW}#g" "$p"
  printf '%-64s %s ref(s)\n' "${p#$ROOT/}" "$n"
  changed=$((changed + 1))
done
[[ "$changed" -gt 0 ]] || { echo "ERROR: no consumer references :${OLD}" >&2; exit 1; }

echo
echo "Leftover references to :${OLD} (expected: historical notes only):"
grep -rnF ":${OLD}" "$ROOT/.github" "$ROOT/docker" "$ROOT/.devcontainer" "$ROOT/scripts" "$ROOT/test/e2e" \
  | perl -ne "print if m{${MATCH}}" || echo "(none)"
