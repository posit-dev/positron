#!/usr/bin/env bash
set -euo pipefail

# log-cache-status.sh
#
# Unified cache status logging for GitHub Actions workflows.
# Displays a formatted table of cache operations (restore/save) with visual indicators.
#
# Usage:
#   log-cache-status.sh <operation>
#
# Arguments:
#   operation: Either "restore" or "save"
#
# Environment Variables (set by GitHub Actions):
#   For restore operation:
#     - RESTORE_NPM: "true" if npm restore is enabled
#     - RESTORE_BUILTINS: "true" if builtins restore is enabled
#     - CACHE_NPM_CORE_HIT: "true" if npm-core cache hit
#     - CACHE_NPM_EXTENSIONS_HIT: "true" if npm-extensions cache hit
#     - CACHE_BUILTINS_HIT: "true" if builtins cache hit
#
#   For save operation:
#     - CACHE_NPM_CORE_HIT: "true"/"false"/"" (empty means not restored)
#     - CACHE_NPM_EXTENSIONS_HIT: "true"/"false"/"" (empty means not restored)
#     - CACHE_BUILTINS_HIT: "true"/"false"/"" (empty means not restored)
#
# Exit Codes:
#   0: Success
#   1: Invalid operation argument

OPERATION="${1:-}"

if [[ "$OPERATION" != "restore" && "$OPERATION" != "save" ]]; then
	echo "Error: Invalid operation '$OPERATION'. Must be 'restore' or 'save'." >&2
	exit 1
fi

log_restore_status() {
	local cache_name="$1"
	local enabled_var="$2"
	local hit_var="$3"

	if [[ "${!enabled_var:-false}" == "true" ]]; then
		if [[ "${!hit_var:-false}" == "true" ]]; then
			printf "%-16s %s\n" "$cache_name" "✅ hit"
		else
			printf "%-16s %s\n" "$cache_name" "❌ miss"
		fi
	else
		printf "%-16s %s\n" "$cache_name" "⏭️  skipped (disabled)"
	fi
}

log_save_status() {
	local cache_name="$1"
	local hit_var="$2"
	local verify_var="${3:-}"  # Optional verification variable for binaries

	local hit_status="${!hit_var:-}"

	if [[ "$hit_status" == "false" ]]; then
		# Cache was missed during restore, should be saved
		if [[ -n "$verify_var" ]]; then
			# Binary cache requires verification
			if [[ "${!verify_var:-false}" == "true" ]]; then
				printf "%-16s %s\n" "$cache_name" "💾 saved"
			else
				printf "%-16s %s\n" "$cache_name" "⚠️  skipped (verification failed)"
				echo "::warning::$cache_name binary verification failed - cache not saved"
			fi
		else
			# Non-binary cache, no verification needed
			printf "%-16s %s\n" "$cache_name" "💾 saved"
		fi
	elif [[ "$hit_status" == "true" ]]; then
		printf "%-16s %s\n" "$cache_name" "✅ skipped (already cached)"
	else
		printf "%-16s %s\n" "$cache_name" "⏭️  skipped (not restored)"
	fi
}

if [[ "$OPERATION" == "restore" ]]; then
	# Restore operation logging
	log_restore_status "npm-core" "RESTORE_NPM" "CACHE_NPM_CORE_HIT"
	log_restore_status "npm-extensions" "RESTORE_NPM" "CACHE_NPM_EXTENSIONS_HIT"
	log_restore_status "builtins" "RESTORE_BUILTINS" "CACHE_BUILTINS_HIT"

elif [[ "$OPERATION" == "save" ]]; then
	# Save operation logging
	log_save_status "npm-core" "CACHE_NPM_CORE_HIT"
	log_save_status "npm-extensions" "CACHE_NPM_EXTENSIONS_HIT"
	log_save_status "builtins" "CACHE_BUILTINS_HIT"
fi
