#!/usr/bin/env bash
# ci-arm reset - wipe this dev container's persisted state so the next "Dev Containers: Reopen in
# Container" runs a full cold build from scratch.
#
# Run on the HOST with the container closed (Dev Containers: Reopen Folder Locally first).
# Removes, scoped to THIS checkout's Compose project:
#   - the dev container(s) for the stack
#   - the data volumes: root + test/e2e + remote node_modules, .build, postgres-data
#   - the bind-mounted out/ (compile output; recreated by the cold build)
#
# All node_modules that could go stale (root, test/e2e, remote) live on the volumes above, so
# removing the volumes clears them. We deliberately do NOT sweep the bind-mounted node_modules
# (.vscode/extensions/*, extensions/*, …): deleting ~80 dirs makes the cold build recreate them in a
# parallel mkdir storm that races VirtioFS and fails with ENOTDIR. npm ci recreates them anyway.
# Leaves your source, .env, and license.txt alone. Pass -y/--yes to skip the prompt.
set -euo pipefail

if [ -f /.dockerenv ]; then
  echo "Run this on the host, not inside the container (Dev Containers: Reopen Folder Locally first)." >&2
  exit 1
fi

YES=0
case "${1:-}" in -y|--yes) YES=1 ;; esac

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

# Derive the Compose project name from docker compose (which reads the local .env), falling back
# to the directory name. This pins the anchor to exactly this checkout's project so reset.sh
# from one worktree can never accidentally wipe another worktree's volumes.
project="$(cd "$HERE" && docker compose config 2>/dev/null | awk '/^name:/{print $2; exit}')"
[ -z "$project" ] && project="$(basename "$HERE")"
anchor="${project}_positron-node-modules"
if ! docker volume ls -q | grep -qxF "$anchor"; then
  echo "No ci-arm volumes found - already clean. Just Reopen in Container for a fresh build."
  vols=""
else
  prefix="${project}_"
  vols="$(docker volume ls -q | grep -E "^${prefix}(positron-node-modules|positron-e2e-node-modules|positron-remote-node-modules|positron-build|postgres-data)$" || true)"
fi

# Containers attached to those volumes (remove first so the volumes free up).
cons=""
for v in $vols; do cons+="$(docker ps -aq --filter "volume=$v") "; done
cons="$(printf '%s' "$cons" | tr ' ' '\n' | sort -u | grep -v '^$' || true)"

echo "ci-arm reset will remove:"
echo "  containers:"
if [ -n "$cons" ]; then
  for c in $cons; do echo "    $(docker inspect -f '{{.Name}} ({{.Config.Image}})' "$c" 2>/dev/null | sed 's#^/##')"; done
else echo "    (none)"; fi
echo "  volumes:"
if [ -n "$vols" ]; then printf '    %s\n' $vols; else echo "    (none)"; fi
echo "  build output: $ROOT/out"
echo

if [ "$YES" -ne 1 ]; then
  read -rp "Proceed? [y/N] " ans
  case "$ans" in y|Y|yes|YES) ;; *) echo "Aborted - nothing removed."; exit 0 ;; esac
fi

[ -n "$cons" ] && { echo "$cons" | xargs docker rm -f >/dev/null; echo "removed containers"; }
[ -n "$vols" ] && { echo "$vols" | xargs docker volume rm >/dev/null; echo "removed volumes"; }
rm -rf "$ROOT/out" && echo "cleared $ROOT/out"

echo
echo "Clean slate. Open positron-ci-lab.code-workspace and run 'Dev Containers: Reopen in Container'"
echo "for a full cold build."
