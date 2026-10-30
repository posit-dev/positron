#!/usr/bin/env bash
# Apply the vscode-python diff between two release tags onto extensions/positron-python
# as a 3-way merge. Conflicted files are left with conflict markers for resolution.
# Run preview.sh first; it fetches the refs this script reads.
#
# Usage: bash apply.sh <start-tag> <end-tag>
set -euo pipefail

if [ $# -ne 2 ]; then
	echo "usage: bash apply.sh <start-tag> <end-tag>" >&2
	exit 2
fi

subdir=extensions/positron-python
start_ref=refs/vscode-python/$1
end_ref=refs/vscode-python/$2

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

for ref in "$start_ref" "$end_ref"; do
	if ! git rev-parse --verify --quiet "$ref" >/dev/null; then
		echo "Missing $ref. Run preview.sh $1 $2 first to fetch it." >&2
		exit 1
	fi
done

if [ -n "$(git status --porcelain)" ]; then
	echo "Working tree is not clean. Commit or set aside changes before applying." >&2
	exit 1
fi

# git apply exits non-zero when it leaves conflicts, which is expected. Any other failure
# (no conflicted paths left behind) means the patch was not applied.
apply_status=0
git diff --binary --no-renames "$start_ref" "$end_ref" |
	git apply --3way --directory="$subdir" || apply_status=$?
if [ "$apply_status" != 0 ] && [ -z "$(git diff --name-only --diff-filter=U)" ]; then
	echo "git apply failed (exit $apply_status) without leaving conflicts; see the errors above." >&2
	exit "$apply_status"
fi

# Positron uses a different npm version, so keep its lockfile and regenerate it with
# `npm install` after the merge commit.
git checkout HEAD -- "$subdir/package-lock.json"

# Upstream sometimes commits build artifacts that Positron ignores (e.g. *.tsbuildinfo).
# This runs after the patch so it sees the merged .gitignore files. Paths Positron already
# tracks are left alone, even when ignored.
while IFS= read -r file; do
	if git cat-file -e "HEAD:$subdir/$file" 2>/dev/null; then
		continue
	fi
	# --no-index: git apply --3way has already staged the new file.
	if [ -f "$subdir/$file" ] && git check-ignore -q --no-index "$subdir/$file"; then
		git rm -q -f -- "$subdir/$file"
		echo "Removed gitignored upstream file: $subdir/$file"
	fi
done < <(git diff --name-only --diff-filter=A --no-renames "$start_ref" "$end_ref")

echo
echo "Conflicted files:"
git diff --name-only --diff-filter=U
