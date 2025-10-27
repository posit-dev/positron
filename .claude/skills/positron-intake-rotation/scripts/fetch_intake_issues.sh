#!/bin/bash
# Fetch issues without status for intake review
# Usage: ./fetch_intake_issues.sh [--json]

set -e

REPO="posit-dev/positron"
JSON_OUTPUT=false

# Parse arguments
while [[ $# -gt 0 ]]; do
	case $1 in
		--json)
			JSON_OUTPUT=true
			shift
			;;
		*)
			echo "Unknown option: $1"
			exit 1
			;;
	esac
done

# Fetch issues without status from the project board
# The intake board view is: https://github.com/orgs/posit-dev/projects/2/views/33
# This fetches open issues that don't have a status field set

if [ "$JSON_OUTPUT" = true ]; then
	# JSON output for programmatic use
	gh issue list \
		--repo "$REPO" \
		--state open \
		--limit 100 \
		--json number,title,author,labels,createdAt,updatedAt,url
else
	# Human-readable output
	echo "📋 Open Issues Without Status (Intake Queue)"
	echo "============================================"
	gh issue list \
		--repo "$REPO" \
		--state open \
		--limit 50
fi
