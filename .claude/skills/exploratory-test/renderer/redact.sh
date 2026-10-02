#!/usr/bin/env bash
#---------------------------------------------------------------------------------------------
#  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
#  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#---------------------------------------------------------------------------------------------

# Replaces the value of every credential scan-shots.mjs names with [REDACTED]
# in the text files under each directory. Shared by publish.sh and CI.
# Usage: redact.sh [--remove] <dir>...
#
# Names only are printed, never a value. A file that cannot be redacted fails
# the run; with --remove it is deleted instead, for CI, which uploads even after
# a failed step.

set -euo pipefail

REMOVE=0
if [ "${1:-}" = --remove ]; then
	REMOVE=1
	shift
fi
# One directory prints paths relative to it; several print them in full.
[ $# -eq 1 ] && PREFIX="${1%/}/" || PREFIX=

NAMES=$(node "$(dirname "$0")/scan-shots.mjs" --names)
for NAME in $NAMES; do
	VALUE=${!NAME:-}
	# Short values would redact common words.
	[ ${#VALUE} -ge 8 ] || continue
	for DIR in "$@"; do
		[ -d "$DIR" ] || continue
		# No match is not a failure.
		{ grep -rlIF -- "$VALUE" "$DIR" 2>/dev/null || true; } | while IFS= read -r FILE; do
			echo "Redacting $NAME from ${FILE#"$PREFIX"}"
			SECRET="$VALUE" perl -pi -e 's/\Q$ENV{SECRET}\E/[REDACTED]/g' "$FILE" || true
			# perl -i skips a file it cannot rewrite and still exits 0, so check the file.
			grep -qF -- "$VALUE" "$FILE" || continue
			if [ $REMOVE = 1 ]; then
				echo "::warning::Could not redact $NAME from ${FILE#"$PREFIX"}; removed it."
				rm -f "$FILE"
			else
				echo "redact: could not redact $NAME from ${FILE#"$PREFIX"}" >&2
				exit 1
			fi
		done
	done
done
