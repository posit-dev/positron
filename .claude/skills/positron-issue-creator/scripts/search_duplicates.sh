#!/bin/bash
# Search for potential duplicate issues and discussions
# Usage: ./search_duplicates.sh <search-query> [--limit N]

set -e

if [ $# -eq 0 ]; then
	echo "Usage: $0 <search-query> [--limit N]"
	echo "Example: $0 \"notebook crash\" --limit 15"
	exit 1
fi

REPO="posit-dev/positron"
LIMIT=20

# Parse arguments
QUERY=""
while [[ $# -gt 0 ]]; do
	case $1 in
		--limit)
			LIMIT="$2"
			shift 2
			;;
		*)
			QUERY="$QUERY $1"
			shift
			;;
	esac
done

# Trim leading/trailing whitespace
QUERY=$(echo "$QUERY" | xargs)

echo "🔍 Searching for potential duplicates: \"$QUERY\""
echo "=================================================="

# Search issues (all states to catch closed duplicates)
echo ""
echo "📋 Potentially Duplicate Issues:"
echo "--------------------------------"
gh issue list \
	--repo "$REPO" \
	--search "$QUERY" \
	--limit "$LIMIT" \
	--state all \
	--json number,title,state,url \
	--jq '.[] | "#\(.number) [\(.state)] - \(.title)\n  \(.url)\n"'

# Search discussions using GraphQL
echo ""
echo "💬 Related Discussions:"
echo "----------------------"
gh api graphql -f query='
	query($owner: String!, $repo: String!, $query: String!, $limit: Int!) {
		search(query: $query, type: DISCUSSION, first: $limit) {
			nodes {
				... on Discussion {
					number
					title
					author {
						login
					}
					url
					closed
				}
			}
		}
	}
' -f owner=posit-dev -f repo=positron -f query="repo:$REPO $QUERY" -F limit="$LIMIT" \
	--jq '.data.search.nodes[] | "#\(.number) [\(if .closed then "CLOSED" else "OPEN" end)] - \(.title)\n  Author: \(.author.login)\n  \(.url)\n"' 2>/dev/null || echo "  (Discussion search unavailable)"

echo ""
echo "💡 Next Steps:"
echo "-------------"
echo "  1. Review the results above for potential duplicates"
echo "  2. If duplicates exist, reference them in your issue or close as duplicate"
echo "  3. If no clear duplicates, proceed with creating the new issue"
