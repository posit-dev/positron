#!/bin/bash
# Fetch open discussions that need attention
# Usage: ./fetch_discussions.sh [--json]

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
	gh api graphql -f query='
		query($owner: String!, $repo: String!) {
			repository(owner: $owner, name: $repo) {
				discussions(first: 20, orderBy: {field: CREATED_AT, direction: DESC}) {
					nodes {
						number
						title
						author {
							login
						}
						createdAt
						updatedAt
						url
						comments(first: 1) {
							totalCount
						}
						category {
							name
						}
					}
				}
			}
		}
	' -f owner=posit-dev -f repo=positron --jq '.data.repository.discussions.nodes'
else
	# Human-readable output
	echo "💬 Recent Open Discussions"
	echo "========================="
	gh api graphql -f query='
		query($owner: String!, $repo: String!) {
			repository(owner: $owner, name: $repo) {
				discussions(first: 20, orderBy: {field: CREATED_AT, direction: DESC}) {
					nodes {
						number
						title
						author {
							login
						}
						createdAt
						comments(first: 1) {
							totalCount
						}
						category {
							name
						}
						url
					}
				}
			}
		}
	' -f owner=posit-dev -f repo=positron --jq '.data.repository.discussions.nodes[] | "#\(.number) - \(.title)\n  Author: \(.author.login) | Comments: \(.comments.totalCount) | Category: \(.category.name)\n  URL: \(.url)\n"'
fi
