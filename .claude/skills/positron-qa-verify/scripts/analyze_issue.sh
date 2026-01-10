#!/bin/bash
# analyze_issue.sh - Gather issue and PR data for QA verification
#
# Usage: ./analyze_issue.sh <issue-number>
#
# This script fetches comprehensive data about an issue and its related PRs
# to help generate verification guides for QA testing.

set -euo pipefail

ISSUE_NUMBER="$1"
REPO="posit-dev/positron"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Analyzing issue #${ISSUE_NUMBER}...${NC}"

# Function to get PR size (lines changed)
get_pr_size() {
	local pr_number="$1"
	gh pr view "$pr_number" --repo "$REPO" --json additions,deletions --jq '.additions + .deletions' 2>/dev/null || echo "0"
}

# 1. Fetch issue details
echo -e "${YELLOW}Fetching issue details...${NC}"
ISSUE_JSON=$(gh issue view "$ISSUE_NUMBER" --repo "$REPO" --json title,body,comments,url,labels,author,createdAt 2>/dev/null)

if [ $? -ne 0 ] || [ -z "$ISSUE_JSON" ]; then
	echo -e "${RED}Failed to fetch issue #${ISSUE_NUMBER}${NC}"
	exit 1
fi

ISSUE_TITLE=$(echo "$ISSUE_JSON" | jq -r '.title')
ISSUE_BODY=$(echo "$ISSUE_JSON" | jq -r '.body // ""')
ISSUE_URL=$(echo "$ISSUE_JSON" | jq -r '.url')
ISSUE_LABELS=$(echo "$ISSUE_JSON" | jq -r '.labels[].name' | paste -sd ',' - || echo "")

echo "Title: $ISSUE_TITLE"
echo "URL: $ISSUE_URL"
echo "Labels: $ISSUE_LABELS"

# 2. Extract comments
echo -e "\n${YELLOW}Analyzing comments...${NC}"
COMMENTS_JSON=$(echo "$ISSUE_JSON" | jq '.comments')
COMMENT_COUNT=$(echo "$COMMENTS_JSON" | jq 'length')
echo "Found $COMMENT_COUNT comments"

# 3. Find linked PRs - simple approach using issue view
echo -e "\n${YELLOW}Detecting linked PRs...${NC}"

# Get PRs that mention this issue
LINKED_PRS=$(gh pr list --repo "$REPO" --search "$ISSUE_NUMBER" --state all --json number --jq '.[].number' 2>/dev/null || echo "")

# Also extract from body and comments text
ALL_PR_REFS=$(echo "$ISSUE_BODY" | grep -oE '#[0-9]+' | sed 's/#//' || echo "")
COMMENT_PR_REFS=$(echo "$COMMENTS_JSON" | jq -r '.[].body // ""' | grep -oE '#[0-9]+' | sed 's/#//' || echo "")

# Combine and deduplicate
ALL_PRS=$(echo -e "${LINKED_PRS}\n${ALL_PR_REFS}\n${COMMENT_PR_REFS}" | sort -u | grep -E '^[0-9]+$' | head -20 || echo "")

if [ -z "$ALL_PRS" ]; then
	echo -e "${YELLOW}No PRs found linked to this issue${NC}"
	PR_LIST="[]"
else
	echo -e "${GREEN}Found potential PR(s): $(echo "$ALL_PRS" | tr '\n' ' ')${NC}"

	# 4. Fetch PR details for each
	PR_LIST="["
	FIRST=true

	for PR_NUM in $ALL_PRS; do
		echo -e "\n${YELLOW}Checking PR #${PR_NUM}...${NC}"

		# Verify this is actually a PR (not just an issue reference)
		PR_JSON=$(gh pr view "$PR_NUM" --repo "$REPO" --json title,body,url,state,comments,author,mergedAt,number 2>/dev/null || echo "")

		if [ -z "$PR_JSON" ] || [ "$PR_JSON" = "null" ]; then
			echo -e "${YELLOW}  #${PR_NUM} is not a PR, skipping${NC}"
			continue
		fi

		PR_TITLE=$(echo "$PR_JSON" | jq -r '.title // ""')
		PR_SIZE=$(get_pr_size "$PR_NUM")

		echo "  Title: $PR_TITLE"
		echo "  Size: $PR_SIZE lines changed"
		echo "  Should review code: $([ "$PR_SIZE" -lt 500 ] && echo 'Yes' || echo 'No (too large)')"

		# Add to JSON array
		if [ "$FIRST" = true ]; then
			FIRST=false
		else
			PR_LIST="${PR_LIST},"
		fi

		PR_LIST="${PR_LIST}$(echo "$PR_JSON" | jq -c ". + {size: $PR_SIZE, shouldReviewCode: $([ "$PR_SIZE" -lt 500 ] && echo 'true' || echo 'false')}")"
	done

	PR_LIST="${PR_LIST}]"
fi

# 5. Extract referenced issues
echo -e "\n${YELLOW}Finding related issues...${NC}"
BODY_ISSUES=$(echo "$ISSUE_BODY" | grep -oE '#[0-9]+' | sed 's/#//' | grep -v "^${ISSUE_NUMBER}$" || echo "")
COMMENT_ISSUES=$(echo "$COMMENTS_JSON" | jq -r '.[].body // ""' | grep -oE '#[0-9]+' | sed 's/#//' | grep -v "^${ISSUE_NUMBER}$" || echo "")
RELATED_ISSUES=$(echo -e "${BODY_ISSUES}\n${COMMENT_ISSUES}" | sort -u | grep -E '^[0-9]+$' | head -20 || echo "")

if [ -n "$RELATED_ISSUES" ]; then
	echo -e "${GREEN}Found related issues: $(echo "$RELATED_ISSUES" | tr '\n' ' ')${NC}"
else
	echo "No related issues found"
fi

# 6. Build final JSON output
echo -e "\n${YELLOW}Building analysis output...${NC}"

OUTPUT_JSON=$(jq -n \
	--arg title "$ISSUE_TITLE" \
	--arg url "$ISSUE_URL" \
	--arg body "$ISSUE_BODY" \
	--arg labels "$ISSUE_LABELS" \
	--arg number "$ISSUE_NUMBER" \
	--argjson comments "$COMMENTS_JSON" \
	--argjson prs "$PR_LIST" \
	--arg related "$(echo "$RELATED_ISSUES" | tr '\n' ',' | sed 's/,$//')" \
	'{
		issue: {
			number: $number,
			title: $title,
			url: $url,
			body: $body,
			labels: $labels,
			commentCount: ($comments | length)
		},
		comments: $comments,
		prs: $prs,
		relatedIssues: ($related | split(",") | map(select(length > 0)))
	}'
)

# Output the JSON
echo "$OUTPUT_JSON"

echo -e "\n${GREEN}Analysis complete!${NC}"
