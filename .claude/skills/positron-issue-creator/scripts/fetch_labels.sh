#!/bin/bash
# Fetch all available labels in the Positron repository
# Usage: ./fetch_labels.sh [--json]

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

if [ "$JSON_OUTPUT" = true ]; then
	# JSON output for programmatic use
	gh label list --repo "$REPO" --json name,description --limit 1000
else
	# Human-readable output grouped by category
	echo "🏷️  Available Labels in posit-dev/positron"
	echo "========================================="
	gh label list --repo "$REPO" --limit 1000 | sort
fi
