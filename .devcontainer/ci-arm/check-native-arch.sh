#!/usr/bin/env bash
# Advisory: warn if the in-tree native binaries (pet/ark/kcserver) aren't Linux ELF inside the
# container. A non-ELF here (e.g. a macOS Mach-O) means this checkout was also built natively on the
# host and the binaries collided -- which silently breaks interpreter/kernel startup. See README
# "Don't mix container and native builds". Always exits 0 (informational).
set -uo pipefail
WS="$(cd "$(dirname "$0")/../.." && pwd)"
bad=0
check() { # <label> <path>
  [ -e "$2" ] || return 0
  local ftype; ftype="$(file -b "$2")"
  if ! printf '%s' "$ftype" | grep -q '^ELF'; then
    [ "$bad" -eq 0 ] && echo "WARNING: wrong-OS interpreter binaries (was this checkout built natively on the host?):"
    bad=1
    echo "  - $1: $(printf '%s' "$ftype" | cut -c1-45)"
  fi
}
check pet      "$WS/extensions/positron-python/python-env-tools/pet"
check ark      "$WS/extensions/positron-r/resources/ark/ark"
check kcserver "$WS/extensions/positron-supervisor/resources/kallichore/kcserver"
if [ "$bad" -eq 1 ]; then
  echo "  Fix: README -> Gotchas -> 'Python/R interpreters dead' (delete the binary + its VERSION, re-run the installer)."
  echo "  Better: keep container work in a dedicated worktree (setup-worktree.sh)."
fi
exit 0
