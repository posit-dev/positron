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
		*.md) return 0 ;;                        # Markdown anywhere
		docs/*) return 0 ;;                      # docs/ tree (segment-anchored)
		*/*) return 1 ;;                         # any other nested path is not a root doc
		LICENSE*|CHANGELOG*|NOTICE*) return 0 ;; # root license/changelog/notice only
		*) return 1 ;;
	esac
}

saw_any=false
result=true

# Check one path, but only while we still believe the change is docs-only.
# Do NOT break out of the loop on the first non-doc file: an early break
# leaves stdin undrained, which SIGPIPEs the upstream producer (printf / git
# diff) under `set -o pipefail` on large inputs. Read to EOF unconditionally.
check_path() {
	if [[ "$result" == "true" ]] && ! is_doc_path "$1"; then
		result=false
	fi
}

while IFS= read -r path; do
	# Skip blank lines (trailing newline, empty stdin).
	[[ -z "$path" ]] && continue
	saw_any=true
	check_path "$path"
done

# Handle the final line when input has no trailing newline (the while-read
# loop does not execute its body for an unterminated last line).
if [[ -n "$path" ]]; then
	saw_any=true
	check_path "$path"
fi

if [[ "$saw_any" != "true" ]]; then
	result=false
fi

printf '%s' "$result"
