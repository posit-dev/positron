#!/usr/bin/env bash
# Preview how a vscode-python release range lands on extensions/positron-python,
# without touching the working tree.
#
# Usage: bash preview.sh <start-tag> <end-tag> [upstream-repo]
#   upstream-repo defaults to https://github.com/microsoft/vscode-python.git
#   (a local clone path also works and is faster).
#
# Writes to a temp dir (path printed at the end):
#   files.tsv    STATUS<TAB>path for every file upstream changed
# Also leaves the fetched tags at refs/vscode-python/<tag> for apply.sh.
#   commits.txt  upstream commits that touch files containing Positron blocks
set -euo pipefail

if [ $# -lt 2 ]; then
	echo "usage: bash preview.sh <start-tag> <end-tag> [upstream-repo]" >&2
	exit 2
fi

start_tag=$1
end_tag=$2
upstream=${3:-https://github.com/microsoft/vscode-python.git}
subdir=extensions/positron-python
start_ref=refs/vscode-python/$start_tag
end_ref=refs/vscode-python/$end_tag

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

git fetch --quiet --no-tags "$upstream" \
	"refs/tags/$start_tag:$start_ref" \
	"refs/tags/$end_tag:$end_ref"

tmp_root=${TMPDIR:-/tmp}
out=$(mktemp -d "${tmp_root%/}/positron-python-preview.XXXXXX")
files="$out/files.tsv"
: >"$files"

blob() {
	git rev-parse --verify --quiet "$1" || true
}

git diff --name-status --no-renames "$start_ref" "$end_ref" >"$out/changed.txt"

while IFS=$'\t' read -r status file; do
	ours=$(blob "HEAD:$subdir/$file")
	base=$(blob "$start_ref:$file")
	theirs=$(blob "$end_ref:$file")
	if [ "$file" = package-lock.json ]; then
		echo -e "LOCKFILE_KEPT\t$file" >>"$files"
	elif [ "$status" = A ] && [ -z "$ours" ]; then
		echo -e "NEW\t$file" >>"$files"
	elif [ -z "$ours" ]; then
		echo -e "MISSING_IN_POSITRON\t$file" >>"$files"
	elif [ "$status" = D ]; then
		if [ "$ours" = "$base" ]; then
			echo -e "DELETED_UPSTREAM\t$file" >>"$files"
		else
			echo -e "DELETED_UPSTREAM_MODIFIED_BY_POSITRON\t$file" >>"$files"
		fi
	elif [ "$ours" = "$theirs" ]; then
		echo -e "ALREADY_UPSTREAM\t$file" >>"$files"
	elif [ -z "$base" ]; then
		echo -e "ADDED_BOTH\t$file" >>"$files"
	elif [ "$ours" = "$base" ]; then
		echo -e "CLEAN\t$file" >>"$files"
	else
		git cat-file blob "$ours" >"$out/ours"
		git cat-file blob "$base" >"$out/base"
		git cat-file blob "$theirs" >"$out/theirs"
		conflicts=$(git merge-file -p "$out/ours" "$out/base" "$out/theirs" | grep -c '^<<<<<<< ' || true)
		positron_blocks=$(grep -c -- '--- Start Positron ---' "$out/ours" || true)
		if [ "$conflicts" = 0 ]; then
			echo -e "AUTOMERGE[positron_blocks=$positron_blocks]\t$file" >>"$files"
		else
			echo -e "CONFLICT[hunks=$conflicts,positron_blocks=$positron_blocks]\t$file" >>"$files"
		fi
	fi
done <"$out/changed.txt"
rm -f "$out/ours" "$out/base" "$out/theirs"

# Files carrying Positron blocks: upstream changes to these can alter Positron behavior.
grep -E '^(AUTOMERGE|CONFLICT)' "$files" | grep -v 'positron_blocks=0' | cut -f2 | sort >"$out/positron-modified.txt"

: >"$out/commits.txt"
while read -r sha subject; do
	touched=$(git diff-tree --no-commit-id --name-only -r --no-renames "$sha" | sort | comm -12 - "$out/positron-modified.txt")
	if [ -n "$touched" ]; then
		{
			echo "$sha $subject"
			while read -r path; do echo "    $path"; done <<<"$touched"
		} >>"$out/commits.txt"
	fi
done < <(git log --no-merges --reverse --format='%h %s' "$start_ref..$end_ref")

echo "Upstream commits: $(git rev-list --no-merges --count "$start_ref..$end_ref")"
echo "Commits touching files with Positron blocks: $(grep -c '^[0-9a-f]' "$out/commits.txt" || true)"
echo
cut -f1 "$files" | sed 's/\[.*//' | sort | uniq -c
echo
echo "Report: $out"
