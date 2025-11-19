#!/bin/bash
# Search for related issues, discussions, and documentation
# Usage: ./search_related.sh <search-query>

set -e

if [ $# -eq 0 ]; then
	echo "Usage: $0 <search-query>"
	echo "Example: $0 \"copilot tools\""
	exit 1
fi

QUERY="$*"
REPO="posit-dev/positron"

echo "🔍 Searching for: \"$QUERY\""
echo "================================"

# Search issues
echo ""
echo "📋 Related Issues:"
echo "-------------------"
gh issue list \
	--repo "$REPO" \
	--search "$QUERY" \
	--limit 10 \
	--state all

# Search discussions (using API since gh doesn't have native discussion search)
echo ""
echo "💬 Related Discussions:"
echo "----------------------"
gh api graphql -f query='
	query($owner: String!, $repo: String!, $query: String!) {
		search(query: $query, type: DISCUSSION, first: 10) {
			nodes {
				... on Discussion {
					number
					title
					author {
						login
					}
					url
				}
			}
		}
	}
' -f owner=posit-dev -f repo=positron -f query="repo:$REPO $QUERY" \
	--jq '.data.search.nodes[] | "#\(.number) - \(.title)\n  Author: \(.author.login)\n  URL: \(.url)\n"' 2>/dev/null || echo "  (Discussion search unavailable)"

echo ""
echo "📚 Documentation Search:"
echo "------------------------"
echo "Search docs manually at: https://positron.posit.co/welcome.html"
echo "Use browser search or grep the docs if cloned locally"
