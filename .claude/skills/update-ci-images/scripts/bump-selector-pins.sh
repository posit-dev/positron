#!/usr/bin/env bash
set -euo pipefail
#
# bump-selector-pins.sh <old_python> <new_python> <old_r> <new_r> [--builds <positron-builds checkout>]
#
# Rewrites the POSITRON_PY_VER_SEL / POSITRON_R_VER_SEL pins that describe the
# primary interpreters INSIDE the CI images. Alt and hidden selectors are
# untouched. Lanes whose interpreters live on the runner (connect, macOS,
# Windows, WSL, release-screenshots, the host side of remote-ssh) are
# deliberately not listed: their versions are not the images' versions.
#
# The test lanes run in posit-dev/positron-builds, so the pins are in two
# repositories. Without --builds the script rewrites this repository's pins
# (the arm-local env script and the ci-arm devcontainer). With --builds it
# rewrites the lane workflows in that checkout. Run it once each way.
#
# Each entry is <file>:<selector regex>. The remote-ssh lane only gets its
# *_REMOTE_* pins rewritten, because those are the ones that name the container.
#
OLD_PY="${1:?usage: bump-selector-pins.sh <old_python> <new_python> <old_r> <new_r>}"
NEW_PY="${2:?missing new python}"
OLD_R="${3:?missing old r}"
NEW_R="${4:?missing new r}"

PRIMARY='POSITRON_(PY|R)_VER_SEL'
REMOTE='POSITRON_(PY|R)_REMOTE_VER_SEL'
if [[ "${5:-}" == "--builds" ]]; then
  ROOT="$(git -C "${6:?--builds needs the path of a positron-builds checkout}" rev-parse --show-toplevel)"
  ENTRIES=(
    ".github/workflows/test-e2e-ubuntu.yml:$PRIMARY"
    ".github/workflows/test-e2e-workbench.yml:$PRIMARY"
    ".github/workflows/test-e2e-jupyter.yml:$PRIMARY"
    ".github/workflows/test-e2e-ssh.yml:$REMOTE"
    ".github/workflows/extensions-check-nightly.yml:$PRIMARY"
    ".github/workflows/test-memory-metrics.yml:$PRIMARY"
  )
  SEARCH=(".github/workflows")
else
  ROOT="$(git rev-parse --show-toplevel)"
  ENTRIES=(
    "docker/environments/arm-local/setup-test-env.sh:$PRIMARY"
    ".devcontainer/ci-arm/devcontainer.json:$PRIMARY"
  )
  SEARCH=("docker/environments" ".devcontainer")
fi

for entry in "${ENTRIES[@]}"; do
  f="${entry%%:*}"; sel="${entry#*:}"; p="$ROOT/$f"
  [[ -f "$p" ]] || { echo "ERROR: expected file missing: $f" >&2; exit 1; }
  before="$(grep -cE "${sel}.*\\b(${OLD_PY//./\\.}|${OLD_R//./\\.})\\b" "$p" || true)"
  [[ "$before" -gt 0 ]] || { echo "ERROR: no ${sel} pin at the old versions in $f" >&2; exit 1; }
  perl -pi -e "if (/${sel}/) { s/\\b\\Q${OLD_PY}\\E\\b/${NEW_PY}/; s/\\b\\Q${OLD_R}\\E\\b/${NEW_R}/ }" "$p"
  printf '%-56s %s line(s)\n' "$f" "$before"
done

echo
echo "Remaining references to the old versions (expected: runner-side pins only):"
(cd "$ROOT" && grep -rnE "\\b(${OLD_PY//./\\.}|${OLD_R//./\\.})\\b" "${SEARCH[@]}") || echo "(none)"
