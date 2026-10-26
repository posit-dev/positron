#!/usr/bin/env bash
set -euo pipefail
#
# bump-interpreter-versions.sh <new_python> <new_r>
#
# Rewrites the primary Python (the uv venv) and primary R (the `rig default`)
# versions in every OS Dockerfile. Every occurrence of the old version string
# in a Dockerfile refers to the primary interpreter (rig add, rpm URLs,
# Makeconf paths, comments), so a whole-file replace is the right operation.
# The alt and hidden interpreters (pyenv 3.13.0, R 4.4.x) are untouched.
#
# Pick a Python patch whose string is not a prefix of another installed
# version: the e2e selectors match by substring (3.13.1 would match 3.13.15).
#
NEW_PY="${1:?usage: bump-interpreter-versions.sh <new_python> <new_r>}"
NEW_R="${2:?missing new R version}"
ROOT="$(git rev-parse --show-toplevel)"

FILES=(
  docker/images/ubuntu24_04/Dockerfile.ubuntu24_04
  docker/images/rocky_8/Dockerfile.rocky_8
  docker/images/rocky_9/Dockerfile.rocky_9
  docker/images/debian/Dockerfile.debian13
  docker/images/openSUSE15_6/Dockerfile.openSUSE15_6
  docker/images/SLES15_6/Dockerfile.SLES15_6
)

for f in "${FILES[@]}"; do
  p="$ROOT/$f"
  [[ -f "$p" ]] || { echo "ERROR: expected file missing: $f" >&2; exit 1; }
  old_py="$(grep -oE 'uv venv --python=[0-9.]+' "$p" | head -1 | sed 's/.*=//')"
  old_r="$(grep -oE 'rig default [0-9.]+' "$p" | head -1 | awk '{print $3}')"
  [[ -n "$old_py" && -n "$old_r" ]] || { echo "ERROR: could not detect primary versions in $f" >&2; exit 1; }
  perl -pi -e "s/\\b\\Q${old_py}\\E\\b/${NEW_PY}/g; s/\\b\\Q${old_r}\\E\\b/${NEW_R}/g" "$p"
  if grep -qE "\\b(${old_py//./\\.}|${old_r//./\\.})\\b" "$p"; then
    echo "ERROR: old version string still present in $f" >&2; exit 1
  fi
  printf '%-52s %s -> %s, %s -> %s\n' "$f" "$old_py" "$NEW_PY" "$old_r" "$NEW_R"
done
