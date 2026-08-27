#!/usr/bin/env bash
# Delete whole GHCR container packages. Use only for packages that the audit
# reported under "would be emptied completely" and whose last tagged version
# ghcr-prune.sh could not delete.
#
# This is a bigger action than deleting versions: the package disappears from
# the org package list, and the 30-day restore path is less reliable for a
# whole package than for a single version. Dry run unless given --confirm.
set -euo pipefail

ORG="posit-dev"
CONFIRM=0
REPO_PATH=""
PKGS=()

usage() {
	cat <<'EOF'
Usage: ghcr-delete-packages.sh --package NAME [--package NAME ...] [options]

  --package NAME   Package to delete (repeatable)
  --org ORG        GitHub org that owns the packages (default: posit-dev)
  --repo-path PATH Checkout to scan; aborts if a package is mentioned anywhere
                   under .github/, docker/, test/, scripts/, or build/
  --confirm        Actually delete. Without this it is a dry run.
EOF
}

while [ $# -gt 0 ]; do
	case "$1" in
		--package) PKGS+=("$2"); shift 2 ;;
		--org) ORG="$2"; shift 2 ;;
		--repo-path) REPO_PATH="$2"; shift 2 ;;
		--confirm) CONFIRM=1; shift ;;
		-h|--help) usage; exit 0 ;;
		*) echo "unknown option: $1" >&2; usage; exit 2 ;;
	esac
done

[ "${#PKGS[@]}" -gt 0 ] || { echo "at least one --package is required" >&2; usage; exit 2; }
command -v gh >/dev/null || { echo "gh not found" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh not authenticated" >&2; exit 1; }

if ! gh auth status 2>&1 | grep -q 'delete:packages'; then
	echo "! The active gh token lacks the delete:packages scope." >&2
	echo "  Run: gh auth refresh -h github.com -s read:packages -s delete:packages" >&2
	exit 1
fi

# --- Report what each package currently holds, and fail closed on unknowns --
echo "Packages targeted for deletion:"
printf '%-42s %-9s %-6s %s\n' "PACKAGE" "VIS" "VERS" "TAGS"
BAD=0
for p in "${PKGS[@]}"; do
	if ! meta=$(gh api "/orgs/$ORG/packages/container/${p//\//%2F}" 2>/dev/null); then
		printf '%-42s %s\n' "$p" "NOT FOUND (already deleted?)"
		BAD=1
		continue
	fi
	vis=$(printf '%s' "$meta" | python3 -c 'import sys,json;print(json.load(sys.stdin)["visibility"])')
	vers=$(gh api "/orgs/$ORG/packages/container/${p//\//%2F}/versions?per_page=100" --paginate \
		--jq '.[] | (.metadata.container.tags // []) | join(",")' 2>/dev/null || true)
	n=$(printf '%s\n' "$vers" | grep -c . || true)
	tags=$(printf '%s' "$vers" | tr '\n' ' ')
	printf '%-42s %-9s %-6s %s\n' "$p" "$vis" "$n" "${tags:-<untagged>}"
done

if [ "$BAD" = "1" ]; then
	echo ""
	echo "! Some packages could not be read. Nothing was deleted." >&2
	exit 1
fi

# --- Refuse if the repo still mentions the package by name -----------------
if [ -n "$REPO_PATH" ]; then
	HITS=0
	for p in "${PKGS[@]}"; do
		for d in .github docker test scripts build; do
			[ -d "$REPO_PATH/$d" ] || continue
			if grep -rl "$p" "$REPO_PATH/$d" 2>/dev/null | head -5 | grep -q .; then
				echo "! $p is still mentioned in $REPO_PATH/$d:" >&2
				grep -rl "$p" "$REPO_PATH/$d" 2>/dev/null | sed 's/^/    /' >&2
				HITS=1
			fi
		done
	done
	if [ "$HITS" = "1" ]; then
		echo "" >&2
		echo "Remove those references first. Nothing was deleted." >&2
		exit 1
	fi
	echo ""
	echo "==> No references to these packages found under $REPO_PATH"
else
	echo ""
	echo "! --repo-path not given: skipping the repo reference check." >&2
fi

echo ""
if [ "$CONFIRM" = "0" ]; then
	echo "DRY RUN -- nothing deleted. Re-run with --confirm to delete these ${#PKGS[@]} packages."
	exit 0
fi

OK=0; FAIL=0
for p in "${PKGS[@]}"; do
	if err=$(gh api -X DELETE "/orgs/$ORG/packages/container/${p//\//%2F}" 2>&1); then
		OK=$((OK+1)); printf '  deleted  %s\n' "$p"
	else
		FAIL=$((FAIL+1)); printf '  FAILED   %s -- %s\n' "$p" "$(printf '%s' "$err" | head -1)" >&2
	fi
done

echo ""
echo "==> Deleted $OK, failed $FAIL of ${#PKGS[@]} packages"
echo "Package deletion may be restorable within 30 days, but is less reliable"
echo "than version restore. See the GitHub Packages docs for restore limits."
[ "$FAIL" = "0" ] || exit 1
