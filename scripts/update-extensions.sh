
#!/usr/bin/env bash

# Update Bootstrap Extensions Script
# Usage:
#   ./update-extensions.sh ms-python.debugpy
#   ./update-extensions.sh ms-python.debugpy --version 2025.10.0
#   ./update-extensions.sh --all
#   ./update-extensions.sh --help

set -euo pipefail

# Check jq once at the top
if ! command -v jq >/dev/null 2>&1; then
	echo -e "\033[0;31mError: jq is required but not installed\033[0m" >&2
	echo -e "\033[1;33mInstall jq: brew install jq (macOS) or apt install jq (Ubuntu)\033[0m" >&2
	exit 1
fi

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
ALLOW_DOWNGRADE=false

# SemVer 2.0 precedence as a jq sort key, shared by the latest-version selector
# and the downgrade guard. This is the shared contract with compareSemver in
# scripts/check-bootstrap-extension-deps.ts; keep the two in step.
#
# Build metadata is dropped before the core is parsed, or "3+linux" reads as 0
# and silently lowers the version. A release sorts above any prerelease of the
# same core (the 1 vs 0 rank), which matters because p3m serves versions such
# as debugpy's 2024.11.0-dev with "pre_release": false: they survive the stable
# filter, and without this a -dev build could outrank its own release. Within a
# prerelease, numeric identifiers sort below alphanumeric ones ([0,n] vs [1,s])
# and a shorter set sorts lower, which jq's array ordering gives us directly.
# The core is padded to a fixed width so 1.2 and 1.2.0 compare equal.
JQ_SEMVER_KEY='
	def is_release_version: (split("+")[0] | test("-") | not);
	def semver_key:
		(split("+")[0] | split("-")) as $parts
		| ((($parts[0] | split(".") | map(tonumber? // 0)) + [0,0,0,0])[0:4]) as $core
		| ($parts[1:]) as $pre
		| if ($pre | length) == 0 then [$core, 1, []]
			else [$core, 0, ($pre | join("-") | split(".")
				| map(if test("^[0-9]+$") then [0, tonumber] else [1, .] end))]
			end;
'

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
		--allow-downgrade     Permit lowering a pinned version (refused by default)
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
EOF
}

# Find product.json in the current directory or parent directories
find_product_json() {
	local dir="$PWD"
	while [[ "$dir" != "/" ]]; do
		if [[ -f "$dir/product.json" ]]; then
			echo "$dir/product.json"
			return 0
		fi
		dir=$(dirname "$dir")
	done
	echo -e "${RED}Error: product.json not found in this directory or any parent directory${NC}" >&2
	exit 1
}

# Extract all bootstrap extension IDs from product.json
get_all_extension_ids() {
	local product_json="$1"
	jq -r '.bootstrapExtensions[] | .name' "$product_json" | sort -u
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

# Get latest version from Posit Public Package Manager and detect platform-specific extensions
get_extension_info() {
	local publisher="$1"
	local name="$2"
	local url="https://p3m.dev/__api__/repos/openvsx/packages/${publisher}.${name}"
	local response

	if ! response=$(curl -s -f "$url" 2>/dev/null); then
		echo -e "${RED}Error: Failed to fetch extension metadata from Posit Public Package Manager${NC}" >&2
		exit 1
	fi

	EXTENSION_VERSION=""
	EXTENSION_TARGET_PLATFORM=""

	if command -v jq >/dev/null 2>&1; then
		# Pick the highest *stable* release by semver. Open VSX marks prerelease
		# builds with "pre_release": true (e.g. pyrefly's 1.1.900x dev builds),
		# and those must not be bootstrapped as if they were releases. The flag
		# alone is not enough: p3m serves debugpy's 2024.11.0-dev with
		# "pre_release": false, and semver only ranks that below 2024.11.0, not
		# below an older genuine release -- so a mislabelled dev build could
		# outrank the newest stable version. Require both the flag and a version
		# string with no prerelease suffix, and fall back to all versions only
		# when that leaves nothing.
		# Select a single entry so version and target_platform stay consistent.
		#
		# Order by semver, not publish date: a publisher can ship a backport
		# after a newer release (Meta published pyrefly 1.2.1 two days after
		# 1.3.1), and sorting by published_at then picks it and silently
		# downgrades the pin. published_at only breaks exact ties. (P3M does not
		# guarantee versions are returned in sorted order, so some explicit
		# ordering is required.)
		#
		# Entries without a usable version string are dropped up front. Both
		# is_release_version and semver_key call split(), which errors on null,
		# so one malformed entry would otherwise abort the whole run under
		# `set -e` without naming the extension.
		local selected
		selected=$(echo "$response" | jq -c "$JQ_SEMVER_KEY"'
			(.versions | map(select((.version | type) == "string" and (.version | length) > 0))) as $usable
			| ($usable | map(select(.pre_release != true and (.version | is_release_version)))) as $stable
			| (if ($stable | length) > 0 then $stable else $usable end)
			| sort_by((.version | semver_key), .published_at) | reverse | .[0] // {}')
		EXTENSION_VERSION=$(echo "$selected" | jq -r '.version // empty')
		EXTENSION_TARGET_PLATFORM=$(echo "$selected" | jq -r '.target_platform // empty')

	else
		# Fallback parsing without jq
		EXTENSION_VERSION=$(echo "$response" | grep -o '"version":"[^\"]*"' | head -1 | cut -d'"' -f4)
		EXTENSION_TARGET_PLATFORM=$(echo "$response" | grep -o '"target_platform":"[^\"]*"' | head -1 | cut -d'"' -f4)
	fi

	# Report failure rather than falling through with an empty version, which
	# downstream would feed to jq (an error) or treat as a real version.
	if [[ -z "$EXTENSION_VERSION" ]]; then
		echo -e "${RED}Error: Could not determine latest version${NC}" >&2
		return 1
	fi
}

# Download VSIX file
download_vsix() {
	local publisher="$1" name="$2" version="$3" target_platform="$4"

	mkdir -p "$VSIX_DIR"

	# Derive the asset base URL from extensionsGallery.serviceUrl in product.json.
	# P3M serves VSIX downloads at: {asset_base}/{publisher}/{name}/{version}/Microsoft.VisualStudio.Services.VSIXPackage
	# where asset_base is the gallery serviceUrl with "gallery" replaced by "asset".
	local gallery_service_url
	gallery_service_url=$(jq -r '.extensionsGallery.serviceUrl // empty' "$PRODUCT_JSON")
	local asset_base="${gallery_service_url%gallery}asset"

	local filename url
	if [[ -n "$target_platform" && "$target_platform" != "universal" ]]; then
		filename="${publisher}.${name}-${version}@${target_platform}.vsix"
		url="${asset_base}/${publisher}/${name}/${version}/Microsoft.VisualStudio.Services.VSIXPackage?targetPlatform=${target_platform}"
	else
		filename="${publisher}.${name}-${version}.vsix"
		url="${asset_base}/${publisher}/${name}/${version}/Microsoft.VisualStudio.Services.VSIXPackage"
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
	local sha256="$5"

	# echo "Checking product.json..."

	# Check current values in product.json
	local extension_id="${publisher}.${name}"
	local current_version=""
	local current_sha256=""
	local has_sha256=false
	local needs_update=false

	if command -v jq >/dev/null 2>&1; then
		# Get current version and hash values
		local extension_info=$(find_extension_entry "$product_json" "$publisher" "$name")

		if [[ -n "$extension_info" && "$extension_info" != "null" ]]; then
			current_version=$(echo "$extension_info" | jq -r '.version // empty')
			if echo "$extension_info" | jq -e 'has("sha256")' >/dev/null 2>&1; then
				current_sha256=$(echo "$extension_info" | jq -r '.sha256 // empty')
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

			short_sha() {
				local sha="$1"
				if [[ -n "$sha" && ${#sha} -ge 12 ]]; then
					echo "${sha:0:7}"
				else
					echo "$sha"
				fi
			}

			if [[ "$version_changed" == true && "$hash_changed" == true ]]; then
				echo "${GREEN}✓ Updated version: $current_version → $version"
				echo "${GREEN}✓ Updated sha: $(short_sha "$current_sha256") → $(short_sha "$sha256")${NC}"
			elif [[ "$version_changed" == true ]]; then
				echo "${GREEN}✓ Updated version: $current_version → v$version${NC}"
			elif [[ "$hash_changed" == true ]]; then
				echo "${GREEN}✓ Updated sha: $(short_sha "$current_sha256") → $(short_sha "$sha256")${NC}"
			fi
		else
			# Remove backup since no changes were made
			[[ -f "${product_json}.backup" ]] && rm "${product_json}.backup"

			if [[ "$has_sha256" == true ]]; then
				echo "${BLUE}Already current: $version, sha matches${NC}"
			else
				echo "${BLUE}Already current: $version${NC}"
			fi
		fi
	fi
}

# Locate a bootstrap extension entry in product.json, matched either by
# publisher/name or by the combined "publisher.name" id. Empty when absent.
find_extension_entry() {
	local product_json="$1" publisher="$2" name="$3"

	jq --arg pub "$publisher" --arg nm "$name" --arg id "${publisher}.${name}" '
		[.. | objects | select((.publisher == $pub and .name == $nm) or .name == $id)] | .[0] // empty
	' "$product_json"
}

# Read the version currently pinned in product.json, or empty when absent.
get_pinned_version() {
	if ! command -v jq >/dev/null 2>&1; then
		return 0
	fi

	find_extension_entry "$@" | jq -r '.version // empty'
}

# True when $1 is a strictly lower version than $2, using the same precedence
# as the latest-version selector so the guard cannot disagree with it.
is_version_lower() {
	jq -e -n --arg a "$1" --arg b "$2" "$JQ_SEMVER_KEY"'
		($a | semver_key) < ($b | semver_key)
	' >/dev/null
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
	local extension_info=$(find_extension_entry "$product_json" "$publisher" "$name")

	if [[ -z "$extension_info" || "$extension_info" == "null" ]]; then
		echo -e "${RED}Error: Extension $extension_id not found in product.json${NC}" >&2
		exit 1
	fi

	local current_version=$(echo "$extension_info" | jq -r '.version // empty')
	local has_sha256=$(echo "$extension_info" | jq -e 'has("sha256")')

	# Decision logic:
	# 1. If versions don't match → need to download
	# 2. If versions match but no SHA field → no need to download
	# 3. If versions match and has SHA field → need to download to verify hash
	if [[ "$current_version" != "$target_version" ]]; then
		echo "Version differs ($current_version → $target_version)"
		return 0  # need to download
	elif [[ "$has_sha256" != "true" ]]; then
		echo "Version matches and no SHA to verify"
		return 1  # no need to download
	else
		echo "Version matches but need to verify SHA"
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
		local version_url="https://p3m.dev/__api__/repos/openvsx/packages/${PUBLISHER}.${NAME}"
		local version_response
		if version_response=$(curl -s -f "$version_url" 2>/dev/null); then
			if command -v jq >/dev/null 2>&1; then
				# Find the matching version (versions array is not guaranteed to be sorted)
				TARGET_PLATFORM=$(echo "$version_response" | jq -r --arg ver "$VERSION" '.versions[] | select(.version == $ver) | .target_platform // empty' | head -1)
			else
				TARGET_PLATFORM=$(echo "$version_response" | grep -o '"target_platform":"[^"]*"' | head -1 | cut -d'"' -f4)
			fi
		else
			TARGET_PLATFORM=""
		fi
	else
		# Skip this extension rather than aborting under `set -e`, so one bad
		# API response does not cost the run every other pending bump.
		if ! get_extension_info "$PUBLISHER" "$NAME"; then
			echo -e "${YELLOW}Skipping $extension_id: could not resolve a latest version${NC}" >&2
			return 0
		fi
		VERSION="$EXTENSION_VERSION"
		TARGET_PLATFORM="$EXTENSION_TARGET_PLATFORM"
		echo "Latest version: $VERSION"
	fi

	# Never walk a pin backwards on our own. A publisher can ship a backport
	# after a newer release and p3m serves both, so a resolution that is stale
	# by semver would otherwise open a downgrade PR unnoticed. Applies to
	# --version too, so a typo cannot quietly roll a bootstrap extension back.
	local pinned
	pinned=$(get_pinned_version "$PRODUCT_JSON" "$PUBLISHER" "$NAME")
	if [[ "$ALLOW_DOWNGRADE" != true && -n "$pinned" ]] && is_version_lower "$VERSION" "$pinned"; then
		local refusal="Refusing to downgrade $extension_id: pinned $pinned is newer than resolved $VERSION"
		echo -e "${YELLOW}${refusal}${NC}" >&2
		echo -e "${YELLOW}Re-run with --allow-downgrade if the rollback is intentional.${NC}" >&2
		# Without this the nightly reports only "No changes to product.json" and
		# Slack posts a failure with no stated cause.
		if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
			printf -- '- %s\n' "$refusal" >> "$GITHUB_STEP_SUMMARY"
		fi
		return 0
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

# Update version/hash in product.json using jq
update_with_jq() {
	local product_json="$1"
	local publisher="$2"
	local name="$3"
	local version="$4"
	local sha256="$5"
	local has_sha256="$6"
	local temp_file=$(mktemp)
	local extension_id="${publisher}.${name}"

	# Use jq to update the version and optionally the sha256
	if [[ "$has_sha256" == true ]]; then
		# Update only version, don't add sha256
		jq --tab --arg pub "$publisher" --arg nm "$name" --arg id "$extension_id" --arg ver "$version" --arg hash "$sha256" '
			def update_extension:
				if type == "object" then
					if (.publisher == $pub and .name == $nm) or .name == $id then
						.version = $ver |
						if has("sha256") then .sha256 = $hash
						else . end
					else
						with_entries(.value |= update_extension)
					end
				elif type == "array" then
					map(update_extension)
				else . end;
			update_extension
		' "$product_json" > "$temp_file"
	else
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
				else . end;
			update_extension
		' "$product_json" > "$temp_file"
	fi
	mv "$temp_file" "$product_json"
}

# Parse arguments and populate EXTENSION_IDS
parse_args() {
	local args=()
	while [[ $# -gt 0 ]]; do
		case "$1" in
			--all)
				PROCESS_ALL=true
				;;
			--version)
				shift
				SPECIFIC_VERSION="$1"
				;;
			--vsix-dir)
				shift
				VSIX_DIR="$1"
				;;
			--allow-downgrade)
				ALLOW_DOWNGRADE=true
				;;
			--help)
				show_help
				exit 0
				;;
			--*)
				# ignore unknown options for now
				;;
			*)
				args+=("$1")
				;;
		esac
		shift
	done

	# Find product.json once for all extensions
	PRODUCT_JSON=$(find_product_json)

	if [[ "$PROCESS_ALL" == true || ${#args[@]} -eq 0 ]]; then
		EXTENSION_IDS=()
		for id in $(get_all_extension_ids "$PRODUCT_JSON"); do
			EXTENSION_IDS+=("$id")
		done
	else
		EXTENSION_IDS=("${args[@]}")
	fi
}

# Main function
main() {
	parse_args "$@"

	if [[ ${#EXTENSION_IDS[@]} -eq 0 ]]; then
		echo -e "${YELLOW}No extensions found to process.${NC}"
		return
	fi

	for extension_id in "${EXTENSION_IDS[@]}"; do
		echo
		echo "=== $extension_id ==="
		process_extension "$extension_id"
	done
}

# Run main function with all arguments
main "$@"

