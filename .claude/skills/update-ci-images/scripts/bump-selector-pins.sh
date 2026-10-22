#!/usr/bin/env bash
set -euo pipefail
#
# bump-selector-pins.sh <old_python> <new_python> <old_r> <new_r>
#
# Rewrites the POSITRON_PY_VER_SEL / POSITRON_R_VER_SEL pins that describe the
# primary interpreters INSIDE the CI images: the container-based workflows,
# the arm-local env script and the ci-arm devcontainer. Alt and hidden
# selectors are untouched. Workflows whose interpreters live on the runner
# (connect, macOS, Windows, release-screenshots, the host side of remote-ssh)
# are deliberately not listed: their versions are not the images' versions.
#
# Each entry is <file>:<selector regex>. The remote-ssh workflow only gets its
# *_REMOTE_* pins rewritten, because those are the ones that name the container.
#
OLD_PY="${1:?usage: bump-selector-pins.sh <old_python> <new_python> <old_r> <new_r>}"
NEW_PY="${2:?missing new python}"
OLD_R="${3:?missing old r}"
NEW_R="${4:?missing new r}"
ROOT="$(git rev-parse --show-toplevel)"

PRIMARY='POSITRON_(PY|R)_VER_SEL'
REMOTE='POSITRON_(PY|R)_REMOTE_VER_SEL'
ENTRIES=(
  ".github/workflows/extensions-check-nightly.yml:$PRIMARY"
  ".github/workflows/test-e2e-debian.yml:$PRIMARY"
  ".github/workflows/test-e2e-jupyter-ubuntu.yml:$PRIMARY"
  ".github/workflows/test-e2e-pyrefly.yml:$PRIMARY"
  ".github/workflows/test-e2e-rocky.yml:$PRIMARY"
  ".github/workflows/test-e2e-sles.yml:$PRIMARY"
  ".github/workflows/test-e2e-suse.yml:$PRIMARY"
  ".github/workflows/test-e2e-ubuntu.yml:$PRIMARY"
  ".github/workflows/test-e2e-ubuntu-run.yml:$PRIMARY"
  ".github/workflows/test-e2e-workbench-linux.yml:$PRIMARY"
  ".github/workflows/test-memory-metrics.yml:$PRIMARY"
  ".github/workflows/test-e2e-remote-ssh-ubuntu.yml:$REMOTE"
  "docker/environments/arm-local/setup-test-env.sh:$PRIMARY"
  ".devcontainer/ci-arm/devcontainer.json:$PRIMARY"
)

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
grep -rnE "\\b(${OLD_PY//./\\.}|${OLD_R//./\\.})\\b" "$ROOT/.github/workflows" "$ROOT/docker/environments" "$ROOT/.devcontainer" || echo "(none)"
