#!/usr/bin/env bash

# Update Extension Script
# Usage:
#   ./update-extension.sh ms-python.debugpy
#   ./update-extension.sh ms-python.debugpy --version 2025.10.0
#   ./update-extension.sh ms-python.debugpy --product-json ./custom-product.json
#   ./update-extension.sh --help

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
PRODUCT_JSON=""
EXTENSION_IDS=()
SPECIFIC_VERSION=""
VSIX_DIR="./vsix-cache"

# Help function
show_help() {
	cat << EOF
Update Extension Script

USAGE:
	$0 <extension-id> [extension-id...] [options]

ARGUMENTS:
	extension-id    One or more extension IDs in format "publisher.name" (e.g., ms-python.debugpy)

OPTIONS:
	--version <ver>       Use specific version instead of latest
	--product-json <path> Path to product.json file (default: auto-detect)
	--vsix-dir <path>     Directory to cache VSIX files (default: ./vsix-cache)
	--help               Show this help message

EXAMPLES:
	$0 ms-python.debugpy
	$0 ms-python.debugpy posit.publisher
	$0 ms-python.debugpy --version 2025.10.0
	$0 ms-python.debugpy --product-json ./product.json

DESCRIPTION:
This script automates the process of updating extension versions in product.json:
	1. Fetches the latest version info from Open VSX Registry
	2. Downloads the VSIX file
	3. Calculates the SHA256 hash
	4. Updates the product.json file with new version and hash

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
		--version)
			SPECIFIC_VERSION="$2"
			shift 2
			;;
		--product-json)
			PRODUCT_JSON="$2"
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

	if [[ ${#EXTENSION_IDS[@]} -eq 0 ]]; then
	echo -e "${RED}Error: At least one extension ID is required${NC}" >&2
	show_help
	exit 1
	fi
}

# Find product.json file
find_product_json() {
	if [[ -n "$PRODUCT_JSON" ]]; then
	if [[ ! -f "$PRODUCT_JSON" ]]; then
		echo -e "${RED}Error: Product JSON file not found: $PRODUCT_JSON${NC}" >&2
		exit 1
	fi
	echo "$PRODUCT_JSON"
	return
	fi

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
	echo -e "${YELLOW}Use --product-json to specify the path${NC}" >&2
	exit 1
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

	# Parse JSON to get the latest version and check for platform-specific versions
	local version target_platform
	if command -v jq >/dev/null 2>&1; then
	version=$(echo "$response" | jq -r '.versions[0].version // .version // empty')
	target_platform=$(echo "$response" | jq -r '.versions[0].targetPlatform // .targetPlatform // empty')

	# If we don't have versions array, try to get from the direct properties
	if [[ -z "$version" ]]; then
		# Try to extract version from download URL as fallback
		local download_url=$(echo "$response" | jq -r '.files.download // empty')
		if [[ -n "$download_url" ]]; then
			version=$(echo "$download_url" | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+[^/]*' | head -1)
			# Extract target platform from URL if present
			if [[ "$download_url" =~ /([^/]+)/[^/]*\.vsix$ ]]; then
				local url_segment="${BASH_REMATCH[1]}"
				# If it's not a version number, it's likely a platform
				if [[ ! "$url_segment" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
					target_platform="$url_segment"
				fi
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

	# Export variables for use by other functions
	EXTENSION_VERSION="$version"
	EXTENSION_TARGET_PLATFORM="$target_platform"
}

# Download VSIX file
download_vsix() {
	local publisher="$1"
	local name="$2"
	local version="$3"
	local target_platform="$4"

	mkdir -p "$VSIX_DIR"

	# Build the filename and URL based on whether it's platform-specific
	local filename url filepath
	if [[ -n "$target_platform" && "$target_platform" != "universal" ]]; then
	filename="${publisher}.${name}-${version}@${target_platform}.vsix"
	url="https://open-vsx.org/api/${publisher}/${name}/${target_platform}/${version}/file/${filename}"
	else
	filename="${publisher}.${name}-${version}.vsix"
	url="https://open-vsx.org/api/${publisher}/${name}/${version}/file/${filename}"
	fi

	filepath="${VSIX_DIR}/${filename}"

	echo "Downloading ${filename}..." >&2

	# Use curl with proper redirect following and progress bar
	if ! curl -L --fail -s -o "$filepath" "$url" >&2; then
	echo -e "${RED}Error: Failed to download VSIX file${NC}" >&2
	echo "URL: $url" >&2
	# Clean up partial download
	[[ -f "$filepath" ]] && rm "$filepath"
	exit 1
	fi

	# Verify the file was actually downloaded and has content
	if [[ ! -s "$filepath" ]]; then
	echo -e "${RED}Error: Downloaded file is empty or doesn't exist${NC}" >&2
	[[ -f "$filepath" ]] && rm "$filepath"
	exit 1
	fi

	echo "$filepath"
}

# Calculate SHA256 hash
calculate_sha256() {
	local filepath="$1"

	# Check if file exists
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

# Update product.json
update_product_json() {
	local product_json="$1"
	local publisher="$2"
	local name="$3"
	local version="$4"
	local sha256="$5"

	echo "Checking product.json..."

	# Check current values in product.json
	local extension_id="${publisher}.${name}"
	local current_version=""
	local current_sha256=""
	local has_sha256=false
	local needs_update=false

	if command -v jq >/dev/null 2>&1; then
	# Get current version and hash values
	local extension_info=$(jq --arg pub "$publisher" --arg nm "$name" --arg id "$extension_id" '
		[.. | objects | select((.publisher == $pub and .name == $nm) or .name == $id)] | .[0] // empty
	' "$product_json")

	if [[ -n "$extension_info" && "$extension_info" != "null" ]]; then
		current_version=$(echo "$extension_info" | jq -r '.version // empty')
		if echo "$extension_info" | jq -e 'has("sha256")' >/dev/null 2>&1; then
			current_sha256=$(echo "$extension_info" | jq -r '.sha256 // empty')
			has_sha256=true
		elif echo "$extension_info" | jq -e 'has("sha256sum")' >/dev/null 2>&1; then
			current_sha256=$(echo "$extension_info" | jq -r '.sha256sum // empty')
			has_sha256=true
		fi
	else
		echo -e "${RED}Error: Extension $extension_id not found in product.json${NC}" >&2
		exit 1
	fi

	# Check if updates are needed
	if [[ "$current_version" != "$version" ]]; then
		needs_update=true
	elif [[ "$has_sha256" == true && "$current_sha256" != "$sha256" ]]; then
		needs_update=true
	fi

	if [[ "$needs_update" == true ]]; then
		# Create a backup
		cp "$product_json" "${product_json}.backup"
		echo "Updating product.json..."
		update_with_jq "$product_json" "$publisher" "$name" "$version" "$sha256" "$has_sha256"

		# Determine what was updated
		local version_changed=$([[ "$current_version" != "$version" ]] && echo true || echo false)
		local hash_changed=$([[ "$has_sha256" == true && "$current_sha256" != "$sha256" ]] && echo true || echo false)

		if [[ "$version_changed" == true && "$hash_changed" == true ]]; then
			# allow-any-unicode-next-line
			echo -e "${GREEN}✅ Updated version ($current_version → v$version) and SHA256${NC}"
		elif [[ "$version_changed" == true ]]; then
			# allow-any-unicode-next-line
			echo -e "${GREEN}✅ Updated version ($current_version → v$version)${NC}"
		elif [[ "$hash_changed" == true ]]; then
			# allow-any-unicode-next-line
			echo -e "${GREEN}✅ Updated SHA256${NC}"
		fi
	else
		# Remove backup since no changes were made
		[[ -f "${product_json}.backup" ]] && rm "${product_json}.backup"

		if [[ "$has_sha256" == true ]]; then
			# allow-any-unicode-next-line
			echo -e "${BLUE}ℹ️  Already current ($version, SHA256 matches)${NC}"
		else
			# allow-any-unicode-next-line
			echo -e "${BLUE}ℹ️  Already current ($version)${NC}"
		fi
	fi
	else
	# Fallback to sed method
	echo -e "${YELLOW}Warning: Using fallback sed method. Consider installing jq for better update detection.${NC}"
	cp "$product_json" "${product_json}.backup"
	update_with_sed "$product_json" "$publisher" "$name" "$version" "$sha256"
	# allow-any-unicode-next-line
	echo -e "${GREEN}✅ Updated (unable to detect if changes were needed)${NC}"
	fi
}

# Update using jq (preferred method)
update_with_jq() {
	local product_json="$1"
	local publisher="$2"
	local name="$3"
	local version="$4"
	local sha256="$5"
	local has_sha256="$6"

	local temp_file=$(mktemp)
	local extension_id="${publisher}.${name}"

	# Update all matching entries - handle both formats:
	# Format 1: separate publisher/name fields: { publisher: "ms-python", name: "debugpy" }
	# Format 2: combined name field: { name: "ms-python.debugpy" }
	if [[ "$has_sha256" == true ]]; then
	# Update both version and sha256/sha256sum (preserve existing field name)
	jq --tab --arg pub "$publisher" --arg nm "$name" --arg id "$extension_id" --arg ver "$version" --arg hash "$sha256" '
		def update_extension:
			if type == "object" then
				if (.publisher == $pub and .name == $nm) or .name == $id then
					.version = $ver |
					if has("sha256") then .sha256 = $hash
					elif has("sha256sum") then .sha256sum = $hash
					else . end
				else
					with_entries(.value |= update_extension)
				end
			elif type == "array" then
				map(update_extension)
			else
				.
			end;
		update_extension
	' "$product_json" > "$temp_file"
	else
	# Update only version, don't add sha256
	jq --tab --arg pub "$publisher" --arg nm "$name" --arg id "$extension_id" --arg ver "$version" '
		def update_extension:
			if type == "object" then
				if (.publisher == $pub and .name == $nm) or .name == $id then
					.version = $ver
				else
					with_entries(.value |= update_extension)
				end
			elif type == "array" then
				map(update_extension)
			else
				.
			end;
		update_extension
	' "$product_json" > "$temp_file"
	fi

	mv "$temp_file" "$product_json"
}

# Update using sed (fallback method)
update_with_sed() {
	local product_json="$1"
	local publisher="$2"
	local name="$3"
	local version="$4"
	local sha256="$5"

	# This is a simplified approach - look for the extension entry and update version/sha256
	# Note: This is less robust than the jq approach but works as a fallback

	echo -e "${YELLOW}Warning: Using fallback sed method. Consider installing jq for safer JSON handling.${NC}"

	# Find lines with the publisher and name, then update version and sha256 in nearby lines
	local temp_file=$(mktemp)
	local in_extension=false
	local updated=false

	while IFS= read -r line; do
	if [[ "$line" =~ \"publisher\":.*\"$publisher\" ]] && [[ "$in_extension" == false ]]; then
		# Check if this is the right extension by looking ahead for the name
		local context=""
		local next_lines=()
		for i in {1..5}; do
			if IFS= read -r next_line; then
				next_lines+=("$next_line")
				context+="$next_line"
				if [[ "$next_line" =~ \"name\":.*\"$name\" ]]; then
					in_extension=true
					break
				fi
			fi
		done

		echo "$line"
		for next_line in "${next_lines[@]}"; do
			if [[ "$in_extension" == true ]]; then
				if [[ "$next_line" =~ (.*\"version\":.*\").*(\".*) ]]; then
					echo "    \"version\": \"$version\","
					updated=true
				elif [[ "$next_line" =~ (.*\"sha256\":.*\").*(\".*) ]]; then
					echo "    \"sha256\": \"$sha256\""
				else
					echo "$next_line"
				fi

				if [[ "$next_line" =~ ^\s*\} ]]; then
					in_extension=false
				fi
			else
				echo "$next_line"
			fi
		done
	else
		echo "$line"
	fi
done < "$product_json" > "$temp_file"

if [[ "$updated" == true ]]; then
	mv "$temp_file" "$product_json"
else
	rm "$temp_file"
	echo -e "${RED}Error: Could not find extension entry to update${NC}" >&2
	exit 1
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

# Download VSIX
VSIX_PATH=$(download_vsix "$PUBLISHER" "$NAME" "$VERSION" "$TARGET_PLATFORM")

# Calculate SHA256
SHA256=$(calculate_sha256 "$VSIX_PATH")

# Update product.json
update_product_json "$PRODUCT_JSON" "$PUBLISHER" "$NAME" "$VERSION" "$SHA256"
}

# Main function
main() {
	parse_args "$@"

	# Find product.json once for all extensions
	PRODUCT_JSON=$(find_product_json)

	# Process each extension
	for extension_id in "${EXTENSION_IDS[@]}"; do
		echo
		echo "=== $extension_id ==="
		process_extension "$extension_id"
	done
}

# Run main function with all arguments
main "$@"
