#!/bin/bash

# Script to extract e2e test tags from test-tags.ts
# Parses the TypeScript enum and outputs categorized tags

set -e

# Navigate to repository root
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
TAGS_FILE="$REPO_ROOT/test/e2e/infra/test-runner/test-tags.ts"

# Check if file exists
if [ ! -f "$TAGS_FILE" ]; then
    echo "Error: test-tags.ts not found at $TAGS_FILE" >&2
    exit 1
fi

# Parse command line arguments
OUTPUT_FORMAT="${1:-markdown}"  # markdown (default), json, or list

# Function to extract all tags
extract_all_tags() {
    grep -E "^\s*[A-Z_]+\s*=\s*'@:" "$TAGS_FILE" | \
        sed -E "s/^[[:space:]]*[A-Z_]+[[:space:]]*=[[:space:]]*'(@:[^']+)'.*/\1/" | \
        sort
}

# Function to categorize tags based on their names
categorize_tags() {
    local tag="$1"

    # Platform tags
    if [[ "$tag" == "@:web" ]] || [[ "$tag" == "@:web-only" ]] || [[ "$tag" == "@:win" ]] || \
       [[ "$tag" == "@:workbench" ]] || [[ "$tag" == "@:rhel-electron" ]] || \
       [[ "$tag" == "@:rhel-web" ]] || [[ "$tag" == "@:remote-ssh" ]]; then
        echo "platform"
    # Performance tags
    elif [[ "$tag" == "@:performance" ]]; then
        echo "performance"
    # Special tags
    elif [[ "$tag" == "@:soft-fail" ]] || [[ "$tag" == "@:critical" ]]; then
        echo "special"
    # Everything else is a feature tag
    else
        echo "feature"
    fi
}

# Function to output in markdown format
output_markdown() {
    echo "## Available E2E Test Tags"
    echo ""

    # Temporary files to store categorized tags
    local feature_tags=$(mktemp)
    local performance_tags=$(mktemp)
    local platform_tags=$(mktemp)
    local special_tags=$(mktemp)

    # Categorize all tags
    while IFS= read -r tag; do
        category=$(categorize_tags "$tag")
        case "$category" in
            feature)
                echo "$tag" >> "$feature_tags"
                ;;
            performance)
                echo "$tag" >> "$performance_tags"
                ;;
            platform)
                echo "$tag" >> "$platform_tags"
                ;;
            special)
                echo "$tag" >> "$special_tags"
                ;;
        esac
    done < <(extract_all_tags)

    echo "### Feature Tags"
    echo "Tags for specific functionality areas:"
    echo '```'
    cat "$feature_tags"
    echo '```'
    echo ""

    echo "### Performance Tags"
    echo "Tags for performance testing:"
    echo '```'
    cat "$performance_tags"
    echo '```'
    echo ""

    echo "### Platform Tags"
    echo "Tags for controlling which platforms run tests:"
    echo '```'
    cat "$platform_tags"
    echo '```'
    echo ""

    echo "### Special Tags"
    echo "Tags with special behavior:"
    echo '```'
    cat "$special_tags"
    echo '```'
    echo ""

    echo "**Notes:**"
    echo "- PRs run Linux/Electron tests by default"
    echo "- Add platform tags to enable additional platforms"
    echo "- \`@:critical\` tag always runs on all PRs"
    echo "- \`@:soft-fail\` tests won't fail merge to main"

    # Clean up temp files
    rm -f "$feature_tags" "$performance_tags" "$platform_tags" "$special_tags"
}

# Function to output in JSON format
output_json() {
    # Arrays to store categorized tags
    declare -a feature_array
    declare -a performance_array
    declare -a platform_array
    declare -a special_array

    # Categorize all tags
    while IFS= read -r tag; do
        category=$(categorize_tags "$tag")
        case "$category" in
            feature)
                feature_array+=("\"$tag\"")
                ;;
            performance)
                performance_array+=("\"$tag\"")
                ;;
            platform)
                platform_array+=("\"$tag\"")
                ;;
            special)
                special_array+=("\"$tag\"")
                ;;
        esac
    done < <(extract_all_tags)


    echo "{"
    echo '  "feature": ['
    IFS=$','; echo "    ${feature_array[*]}"
    echo '  ],'
    echo '  "performance": ['
    IFS=$','; echo "    ${performance_array[*]}"
    echo '  ],'
    echo '  "platform": ['
    IFS=$','; echo "    ${platform_array[*]}"
    echo '  ],'
    echo '  "special": ['
    IFS=$','; echo "    ${special_array[*]}"
    echo '  ]'
    echo "}"
}

# Function to output simple list
output_list() {
    extract_all_tags
}

# Main execution
case "$OUTPUT_FORMAT" in
    markdown|md)
        output_markdown
        ;;
    json)
        output_json
        ;;
    list)
        output_list
        ;;
    *)
        echo "Error: Unknown format '$OUTPUT_FORMAT'. Use 'markdown', 'json', or 'list'" >&2
        exit 1
        ;;
esac