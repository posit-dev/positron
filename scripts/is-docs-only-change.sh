#!/usr/bin/env bash
# Reads a newline-delimited list of repo-relative changed file paths on stdin.
# Prints "true" iff the list is non-empty AND every path is a docs-only file
# (Markdown anywhere, docs/** tree, or root LICENSE*/CHANGELOG*/NOTICE*).
# Prints "false" otherwise. Used by CI to skip heavy test suites for changes
# that no test could exercise. Conservative by design: any non-doc file, or an
# empty diff, yields "false" so full CI runs.
set -uo pipefail

# Return 0 (docs-only) if the single path matches the allowlist.
is_doc_path() {
	local path="$1"
	case "$path" in
		*.md) return 0 ;;                       # Markdown anywhere
		docs/*) return 0 ;;                     # docs/ tree (segment-anchored)
		LICENSE*|CHANGELOG*|NOTICE*) return 0 ;; # root license/changelog/notice
		*) return 1 ;;
	esac
}

saw_any=false
result=true
while IFS= read -r path; do
	# Skip blank lines (trailing newline, empty stdin).
	[[ -z "$path" ]] && continue
	saw_any=true
	if ! is_doc_path "$path"; then
		result=false
		break
	fi
done

# Handle the last line if input doesn't end with newline
if [[ -n "$path" && "$result" == "true" ]]; then
	saw_any=true
	if ! is_doc_path "$path"; then
		result=false
	fi
fi

if [[ "$saw_any" != "true" ]]; then
	result=false
fi

printf '%s' "$result"
