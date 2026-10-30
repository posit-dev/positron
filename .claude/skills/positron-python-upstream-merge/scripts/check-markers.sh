#!/usr/bin/env bash
# Check files changed relative to a base ref for leftover conflict markers and for
# "--- Start Positron ---" / "--- End Positron ---" pairing problems the change introduced.
# Pairing problems that already exist at the base ref are not reported.
#
# Usage: bash check-markers.sh [base-ref]   (default: HEAD)
set -euo pipefail

base=${1:-HEAD}
repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

pairing_problems() {
	awk '
		/--- Start Positron ---/ { if (open) { printf "%d: Start Positron inside a block opened at line %d\n", NR, line } open = 1; line = NR }
		/--- End Positron ---/ { if (!open) { printf "%d: End Positron without a matching Start\n", NR } open = 0 }
		END { if (open) { printf "%d: Start Positron never closed\n", line } }
	'
}

status=0
while IFS= read -r file; do
	[ -f "$file" ] || continue
	if grep -nE '^(<<<<<<<|>>>>>>>|\|\|\|\|\|\|\|)( |$)' "$file"; then
		echo "^ conflict markers in $file"
		status=1
	fi
	now=$(pairing_problems <"$file")
	before=$( (git show "$base:$file" 2>/dev/null || true) | pairing_problems)
	now_count=$(grep -c . <<<"$now" || true)
	before_count=$(grep -c . <<<"$before" || true)
	if [ "$now_count" -gt "$before_count" ]; then
		echo "$file: Positron marker pairing problems went from $before_count to $now_count:"
		while IFS= read -r problem; do echo "    line $problem"; done <<<"$now"
		status=1
	fi
done < <(
	git diff --name-only "$base" -- extensions/positron-python
	git ls-files --others --exclude-standard -- extensions/positron-python
)

if [ "$status" = 0 ]; then
	echo "No conflict markers or new Positron marker pairing problems."
fi
exit "$status"
