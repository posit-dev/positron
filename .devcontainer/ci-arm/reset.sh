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

# Dev Containers prefixes its Compose volumes with a project name it derives. Anchor on our unique
# positron-node-modules volume, take its prefix, and scope everything (incl. the generic
# postgres-data) to that one project - so a second positron worktree's volumes are never touched.
anchor="$(docker volume ls -q | grep -E 'positron-node-modules$' | head -1 || true)"
if [ -z "$anchor" ]; then
  echo "No ci-arm volumes found - already clean. Just Reopen in Container for a fresh build."
  vols=""
else
  prefix="${anchor%positron-node-modules}"
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

[ -n "$cons" ] && { docker rm -f $cons >/dev/null; echo "removed containers"; }
[ -n "$vols" ] && { docker volume rm $vols >/dev/null; echo "removed volumes"; }
rm -rf "$ROOT/out" && echo "cleared $ROOT/out"

echo
echo "Clean slate. Open positron-ci-lab.code-workspace and run 'Dev Containers: Reopen in Container'"
echo "for a full cold build."
