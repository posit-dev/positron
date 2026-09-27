#!/usr/bin/env bash
#---------------------------------------------------------------------------------------------
#  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
#  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#---------------------------------------------------------------------------------------------

# Publishes a local run directory to the CDN CI publishes to, and prints its URL.
# Usage: publish.sh <run dir>
#
# Uploads a redacted copy, never the run directory itself: the page re-rendered
# for its URL, so its issues link back to it; actions.log and the raw log tree
# stay local, as in CI; and the value of every environment variable
# whose name ends in KEY, TOKEN, SECRET, PASSWORD or PAT is replaced in text
# files. Screenshots are not redacted. Needs AWS credentials that can write to
# the bucket (AWS_PROFILE is honored); AWS_CLI overrides the aws binary.

set -euo pipefail

RUN=${1:?usage: publish.sh <run dir>}
AWS=${AWS_CLI:-aws}
BUCKET=positron-test-reports
CDN=https://d38p2avprg8il3.cloudfront.net

# The page is rendered here, for its URL, so only the report has to exist.
[ -f "$RUN/report.md" ] || { echo "publish: no report.md in $RUN." >&2; exit 1; }

if ! "$AWS" sts get-caller-identity >/dev/null 2>&1; then
	echo "publish: no AWS credentials. Run 'aws sso login' (with AWS_PROFILE set to a profile that can write to $BUCKET) and try again." >&2
	exit 1
fi

# Random, so a local report's URL cannot be guessed from another's.
DIR="exploratory-report-local-$(date -u +%Y%m%d-%H%M%S)-$(openssl rand -hex 4)"

STAGE=$(mktemp -d "${TMPDIR:-/tmp}/exploratory-publish.XXXXXX")
trap 'rm -rf "$STAGE"' EXIT
cp -a "$RUN/." "$STAGE/"
rm -rf "$STAGE/actions.log" "$STAGE/logs/all"
# From the run directory, whose logs and start time the page reads.
node "$(dirname "$0")/render.mjs" "$RUN/report.md" --base "$CDN/$DIR" --out "$STAGE/index.html" >/dev/null

# Names only: a value is never printed. Short values would redact common words.
for NAME in $(compgen -e | grep -Ei '(KEY|TOKEN|SECRET|PASSWORD|PAT)$' || true); do
	VALUE=${!NAME:-}
	[ ${#VALUE} -ge 8 ] || continue
	# No match is not a failure; a file that cannot be redacted stops the upload.
	{ grep -rlIF -- "$VALUE" "$STAGE" 2>/dev/null || true; } | while IFS= read -r FILE; do
		echo "Redacting $NAME from ${FILE#"$STAGE"/}"
		SECRET="$VALUE" perl -pi -e 's/\Q$ENV{SECRET}\E/[REDACTED]/g' "$FILE" \
			|| { echo "publish: could not redact $NAME from ${FILE#"$STAGE"/}; nothing was uploaded." >&2; exit 1; }
	done
done

"$AWS" s3 cp "$STAGE/." "s3://$BUCKET/$DIR" --recursive --region us-east-1 --only-show-errors
echo "$CDN/$DIR/index.html"
