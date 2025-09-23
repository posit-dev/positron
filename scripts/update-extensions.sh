#!/usr/bin/env bash

# Update Bootstrap Extensions Script
# Usage:
#   ./update-extensions.sh ms-python.debugpy
#   ./update-extensions.sh ms-python.debugpy --version 2025.10.0
#   ./update-extensions.sh --all
#   ./update-extensions.sh --help

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
EXTENSION_IDS=()
SPECIFIC_VERSION=""
VSIX_DIR="./vsix-cache"
PROCESS_ALL=false

# Help function
show_help() {
	cat << EOF
Update Bootstrap Extensions Script

USAGE:
	$0 [extension-id...] [options]
	$0 --all [options]

ARGUMENTS:
	extension-id    One or more extension IDs in format "publisher.name" (e.g., ms-python.debugpy)
					If no extension IDs are provided, all bootstrap extensions from product.json will be processed

OPTIONS:
	--all                 Process all bootstrap extensions from product.json (same as providing no extension IDs)
	--version <ver>       Use specific version instead of latest
	--vsix-dir <path>     Directory to cache VSIX files (default: ./vsix-cache)
	--help                Show this help message

EXAMPLES:
	$0 ms-python.debugpy
	$0 ms-python.debugpy posit.publisher
	$0 ms-python.debugpy --version 2025.10.0
	$0 --all
	$0

DESCRIPTION:
This script automates the process of updating extension versions in product.json:
	1. Fetches the latest version info from Open VSX Registry
	2. Downloads the VSIX file (only if needed)
	3. Calculates the SHA256 hash
	4. Updates the product.json file with new version and hash

When run without extension IDs, it will process ALL bootstrap extensions found in product.json.

EOF
}

# Parse arguments
parse_args() {
	while [[ $# -gt 0 ]]; do
	case $1 in
		--help|-h)
			show_help
			exit 0
			;;
		--all)
			PROCESS_ALL=true
			shift
			;;
		--version)
			SPECIFIC_VERSION="$2"
			shift 2
			;;
		--vsix-dir)
			VSIX_DIR="$2"
			shift 2
			;;
		-*)
			echo -e "${RED}Error: Unknown option $1${NC}" >&2
			exit 1
			;;
		*)
			EXTENSION_IDS+=("$1")
			shift
			;;
	esac
	done

	# If no extension IDs provided and --all not explicitly set, default to processing all
	if [[ ${#EXTENSION_IDS[@]} -eq 0 && "$PROCESS_ALL" == false ]]; then
		PROCESS_ALL=true
	fi
}

# Find product.json file
find_product_json() {
	# Auto-detect product.json
	local candidates=(
		"./product.json"
		"../product.json"
		"../../product.json"
		"./positron/product.json"
	)

	for candidate in "${candidates[@]}"; do
		if [[ -f "$candidate" ]]; then
			echo "$candidate"
			return
		fi
	done

	echo -e "${RED}Error: Could not find product.json file${NC}" >&2
	exit 1
}

# Extract all extension IDs from product.json
get_all_extension_ids() {
	local product_json="$1"

	if ! command -v jq >/dev/null 2>&1; then
		echo -e "${RED}Error: jq is required but not installed${NC}" >&2
		echo -e "${YELLOW}Install jq: brew install jq (macOS) or apt install jq (Ubuntu)${NC}" >&2
		exit 1
	fi

	local ids=$(jq -r '
		.bootstrapExtensions // [] |
		map(
			if has("publisher") and .publisher != null and .publisher != "" then
				.publisher + "." + .name
			elif .name | contains(".") then
				.name
			else empty end
		) | unique | .[]
	' "$product_json" 2>/dev/null)

	if [[ -z "$ids" ]]; then
		echo -e "${RED}Error: No bootstrap extension IDs found in product.json${NC}" >&2
		exit 1
	fi

	echo "$ids"
}

# Split extension ID into publisher and name
split_extension_id() {
	local id="$1"
	if [[ ! "$id" =~ ^([^.]+)\.(.+)$ ]]; then
	echo -e "${RED}Error: Invalid extension ID format. Use 'publisher.name'${NC}" >&2
	exit 1
	fi
	PUBLISHER="${BASH_REMATCH[1]}"
	NAME="${BASH_REMATCH[2]}"
}

# Get latest version from Open VSX and detect platform-specific extensions
get_extension_info() {
	local publisher="$1"
	local name="$2"
	local url="https://open-vsx.org/api/${publisher}/${name}"
	local response

	if ! response=$(curl -s -f "$url" 2>/dev/null); then
		echo -e "${RED}Error: Failed to fetch extension metadata from Open VSX${NC}" >&2
		exit 1
	fi

	local version target_platform
	if command -v jq >/dev/null 2>&1; then
		version=$(echo "$response" | jq -r '.versions[0].version // .version // empty')
		target_platform=$(echo "$response" | jq -r '.versions[0].targetPlatform // .targetPlatform // empty')

		# If no version found, try extracting from download URL
		if [[ -z "$version" ]]; then
			local download_url=$(echo "$response" | jq -r '.files.download // empty')
			if [[ -n "$download_url" ]]; then
				version=$(echo "$download_url" | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+[^/]*' | head -1)
				# Extract target platform from URL if present
				if [[ "$download_url" =~ /([^/]+)/[^/]*\.vsix$ && ! "${BASH_REMATCH[1]}" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
					target_platform="${BASH_REMATCH[1]}"
				fi
			fi
		fi
	else
		# Fallback parsing without jq
		version=$(echo "$response" | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)
		target_platform=$(echo "$response" | grep -o '"targetPlatform":"[^"]*"' | head -1 | cut -d'"' -f4)
	fi

	if [[ -z "$version" ]]; then
		echo -e "${RED}Error: Could not determine latest version${NC}" >&2
		exit 1
	fi

	EXTENSION_VERSION="$version"
	EXTENSION_TARGET_PLATFORM="$target_platform"
}

# Download VSIX file
download_vsix() {
	local publisher="$1" name="$2" version="$3" target_platform="$4"

	mkdir -p "$VSIX_DIR"

	local filename url
	if [[ -n "$target_platform" && "$target_platform" != "universal" ]]; then
		filename="${publisher}.${name}-${version}@${target_platform}.vsix"
		url="https://open-vsx.org/api/${publisher}/${name}/${target_platform}/${version}/file/${filename}"
	else
		filename="${publisher}.${name}-${version}.vsix"
		url="https://open-vsx.org/api/${publisher}/${name}/${version}/file/${filename}"
	fi

	local filepath="${VSIX_DIR}/${filename}"
	echo "Downloading ${filename}..." >&2

	if ! curl -L --fail -s -o "$filepath" "$url" >&2 || [[ ! -s "$filepath" ]]; then
		echo -e "${RED}Error: Failed to download VSIX file${NC}" >&2
		echo "URL: $url" >&2
		[[ -f "$filepath" ]] && rm "$filepath"
		exit 1
	fi

	echo "$filepath"
}

# Calculate SHA256 hash
calculate_sha256() {
	local filepath="$1"

	if [[ ! -f "$filepath" ]]; then
		echo -e "${RED}Error: File not found: $filepath${NC}" >&2
		exit 1
	fi

	if command -v shasum >/dev/null 2>&1; then
		shasum -a 256 "$filepath" | cut -d' ' -f1
	elif command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$filepath" | cut -d' ' -f1
	else
		echo -e "${RED}Error: No SHA256 command found (shasum or sha256sum)${NC}" >&2
		exit 1
	fi
}

# Update product.json with new extension version/hash
update_product_json() {
	local product_json="$1"
	local publisher="$2"
	local name="$3"
	local version="$4"
	local sha256="$5"  # Can be empty if no download occurred

	if ! command -v jq >/dev/null 2>&1; then
		echo -e "${RED}Error: jq is required but not installed${NC}" >&2
		echo -e "${YELLOW}Install jq: brew install jq (macOS) or apt install jq (Ubuntu)${NC}" >&2
		exit 1
	fi

	echo "Checking product.json..."

	local extension_id="${publisher}.${name}"
	local extension_info=$(jq --arg pub "$publisher" --arg nm "$name" --arg id "$extension_id" '
		[.. | objects | select((.publisher == $pub and .name == $nm) or .name == $id)] | .[0] // empty
	' "$product_json")

	if [[ -z "$extension_info" || "$extension_info" == "null" ]]; then
		echo -e "${RED}Error: Extension $extension_id not found in product.json${NC}" >&2
		exit 1
	fi

	local current_version=$(echo "$extension_info" | jq -r '.version // empty')
	local current_sha256=$(echo "$extension_info" | jq -r '.sha256 // .sha256sum // empty')
	local has_sha256=$(echo "$extension_info" | jq -e 'has("sha256") or has("sha256sum")')
	local needs_update=false

	# Check if updates are needed
	if [[ "$current_version" != "$version" ]] || [[ "$has_sha256" == "true" && -n "$sha256" && "$current_sha256" != "$sha256" ]]; then
		needs_update=true
	fi

	if [[ "$needs_update" == true ]]; then
		cp "$product_json" "${product_json}.backup"
		echo "Updating product.json..."

		local temp_file=$(mktemp)
		local update_logic
		if [[ -n "$sha256" && "$has_sha256" == "true" ]]; then
			update_logic='.version = $ver | if has("sha256") then .sha256 = $hash elif has("sha256sum") then .sha256sum = $hash else . end'
		else
			update_logic='.version = $ver'
		fi

		jq --tab --arg pub "$publisher" --arg nm "$name" --arg id "$extension_id" --arg ver "$version" --arg hash "$sha256" "
			def update_extension:
				if type == \"object\" then
					if (.publisher == \$pub and .name == \$nm) or .name == \$id then
						$update_logic
					else
						with_entries(.value |= update_extension)
					end
				elif type == \"array\" then
					map(update_extension)
				else
					.
				end;
			update_extension
		" "$product_json" > "$temp_file" && mv "$temp_file" "$product_json"

		# Report what was updated
		local version_changed=$([[ "$current_version" != "$version" ]] && echo true || echo false)
		local hash_changed=$([[ "$has_sha256" == "true" && -n "$sha256" && "$current_sha256" != "$sha256" ]] && echo true || echo false)

		if [[ "$version_changed" == true && "$hash_changed" == true ]]; then
			echo -e "${GREEN}✅ Updated version ($current_version → v$version) and SHA256${NC}"
		elif [[ "$version_changed" == true ]]; then
			echo -e "${GREEN}✅ Updated version ($current_version → v$version)${NC}"
		elif [[ "$hash_changed" == true ]]; then
			echo -e "${GREEN}✅ Updated SHA256${NC}"
		fi
	else
		[[ -f "${product_json}.backup" ]] && rm "${product_json}.backup"
		if [[ "$has_sha256" == "true" ]]; then
			echo -e "${BLUE}ℹ️  Already current ($version, SHA256 matches)${NC}"
		else
			echo -e "${BLUE}ℹ️  Already current ($version)${NC}"
		fi
	fi
}

# Check if we need to download and update
should_download() {
	local product_json="$1"
	local publisher="$2"
	local name="$3"
	local target_version="$4"

	if ! command -v jq >/dev/null 2>&1; then
		return 0  # Download if we can't check
	fi

	local extension_id="${publisher}.${name}"
	local extension_info=$(jq --arg pub "$publisher" --arg nm "$name" --arg id "$extension_id" '
		[.. | objects | select((.publisher == $pub and .name == $nm) or .name == $id)] | .[0] // empty
	' "$product_json")

	if [[ -z "$extension_info" || "$extension_info" == "null" ]]; then
		echo -e "${RED}Error: Extension $extension_id not found in product.json${NC}" >&2
		exit 1
	fi

	local current_version=$(echo "$extension_info" | jq -r '.version // empty')
	local has_sha256=$(echo "$extension_info" | jq -e 'has("sha256") or has("sha256sum")')

	# Decision logic:
	# 1. If versions don't match → need to download
	# 2. If versions match but no SHA field → no need to download
	# 3. If versions match and has SHA field → need to download to verify hash
	if [[ "$current_version" != "$target_version" ]]; then
		echo "Version differs ($current_version → $target_version)"
		return 0  # need to download
	elif [[ "$has_sha256" != "true" ]]; then
		echo "Version matches ($target_version) and no SHA to verify"
		return 1  # no need to download
	else
		echo "Version matches ($target_version) but need to verify SHA"
		return 0  # need to download to verify hash
	fi
}

# Process a single extension
process_extension() {
	local extension_id="$1"

	# Split extension ID
	split_extension_id "$extension_id"

	# Get extension info (version and platform)
	if [[ -n "$SPECIFIC_VERSION" ]]; then
		VERSION="$SPECIFIC_VERSION"
		echo "Using specified version: $VERSION"
		# For specific versions, we need to determine platform by trying the API
		# Try to get platform info for the specific version
		local version_url="https://open-vsx.org/api/${PUBLISHER}/${NAME}/${VERSION}"
		local version_response
		if version_response=$(curl -s -f "$version_url" 2>/dev/null); then
			if command -v jq >/dev/null 2>&1; then
				TARGET_PLATFORM=$(echo "$version_response" | jq -r '.targetPlatform // empty')
			else
				TARGET_PLATFORM=$(echo "$version_response" | grep -o '"targetPlatform":"[^"]*"' | head -1 | cut -d'"' -f4)
			fi
		else
			TARGET_PLATFORM=""
		fi
	else
		get_extension_info "$PUBLISHER" "$NAME"
		VERSION="$EXTENSION_VERSION"
		TARGET_PLATFORM="$EXTENSION_TARGET_PLATFORM"
		echo "Latest version: $VERSION"
	fi

	# Check if we actually need to download
	if should_download "$PRODUCT_JSON" "$PUBLISHER" "$NAME" "$VERSION"; then
		# Download VSIX
		VSIX_PATH=$(download_vsix "$PUBLISHER" "$NAME" "$VERSION" "$TARGET_PLATFORM")

		# Calculate SHA256
		SHA256=$(calculate_sha256 "$VSIX_PATH")

		# Update product.json with version and SHA256
		update_product_json "$PRODUCT_JSON" "$PUBLISHER" "$NAME" "$VERSION" "$SHA256"
	else
		# No download needed - just report that it's already current
		# But still call update_product_json to show the proper status message
		update_product_json "$PRODUCT_JSON" "$PUBLISHER" "$NAME" "$VERSION" ""
	fi
}

# Main function
main() {
	parse_args "$@"

	# Find product.json once for all extensions
	PRODUCT_JSON=$(find_product_json)

	# Determine which extensions to process
	local extensions_to_process=()
	if [[ "$PROCESS_ALL" == true ]]; then
		echo "Processing all bootstrap extensions from product.json..."
		while IFS= read -r extension_id; do
			[[ -n "$extension_id" ]] && extensions_to_process+=("$extension_id")
		done < <(get_all_extension_ids "$PRODUCT_JSON")
		echo "Found ${#extensions_to_process[@]} bootstrap extensions to process"
	else
		extensions_to_process=("${EXTENSION_IDS[@]}")
	fi

	# Process each extension
	for extension_id in "${extensions_to_process[@]}"; do
		echo
		echo "=== $extension_id ==="
		process_extension "$extension_id"
	done
}

# Run main function with all arguments
main "$@"
