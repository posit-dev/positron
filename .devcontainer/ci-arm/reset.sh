#!/usr/bin/env bash
# ci-arm reset - wipe this dev container's persisted state so the next "Dev Containers: Reopen in
# Container" runs a full cold build from scratch.
#
# Run on the HOST with the container closed (Dev Containers: Reopen Folder Locally first).
# Removes, scoped to THIS checkout's Compose project:
#   - the dev container(s) for the stack
#   - the data volumes: root + test/e2e + remote node_modules, .build, postgres-data
#   - EVERY bind-mounted node_modules under the checkout (the other ~80 dirs) - so a volume-only
#     reset can't leave a stale, half-reset tree that breaks the cold build (the bug this guards
#     against: fresh root install re-hoists a dep, a leftover native build tree can't find it)
#   - the bind-mounted out/ (compile output; recreated by the cold build)
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

# Bind-mounted node_modules on the host (the ~80 dirs not on a volume). Stale trees here are what
# break a cold build after a volume-only reset, so clear them. Volume-backed paths (root, test/e2e,
# remote) are empty on the host, so they don't show up. -prune = don't descend into a node_modules
# once matched (rm -rf takes its nested ones too).
#
# CRUCIAL: skip any node_modules that contains git-TRACKED files. VS Code commits a few test fixtures
# inside node_modules/ paths (e.g. linksTestFixtures/node_modules/foo) — those are source, not
# dependencies, and deleting them would dirty the working tree. We build the deletable list once here
# so the preview count and the actual removal can't disagree.
nm_dirs=""
while IFS= read -r d; do
  [ -n "$d" ] || continue
  [ -z "$(git -C "$ROOT" ls-files -- "$d" 2>/dev/null | head -1)" ] && nm_dirs+="$d"$'\n'
done < <(find "$ROOT" -type d -name node_modules -prune 2>/dev/null)
nm_count="$(printf '%s' "$nm_dirs" | grep -c . || true)"

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
echo "  host node_modules dirs: $nm_count"
echo "  build output: $ROOT/out"
echo

if [ "$YES" -ne 1 ]; then
  read -rp "Proceed? [y/N] " ans
  case "$ans" in y|Y|yes|YES) ;; *) echo "Aborted - nothing removed."; exit 0 ;; esac
fi

[ -n "$cons" ] && { docker rm -f $cons >/dev/null; echo "removed containers"; }
[ -n "$vols" ] && { docker volume rm $vols >/dev/null; echo "removed volumes"; }
printf '%s' "$nm_dirs" | while IFS= read -r d; do [ -n "$d" ] && rm -rf "$d"; done
echo "cleared $nm_count host node_modules dir(s) (git-tracked fixtures kept)"
rm -rf "$ROOT/out" && echo "cleared $ROOT/out"

echo
echo "Clean slate. Open positron-ci.code-workspace and run 'Dev Containers: Reopen in Container'"
echo "for a full cold build."
