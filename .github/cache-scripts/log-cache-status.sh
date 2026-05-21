#!/usr/bin/env bash
# ============================================================================
# log-cache-status.sh - Cache Operation Status Logger
# ============================================================================
#
# WHAT THIS DOES:
# Displays a formatted table showing cache restore/save operations.
# Makes it easy to see at a glance which caches hit, missed, or partially hit.
#
# THREE-STATE CACHE LOGGING (Restore):
# • ✅ hit (exact key)       → Cache exact key matched, fastest!
# • ⚠️ partial (restore-key) → restore-key matched, good but not perfect
# • ❌ miss                  → No cache found, will rebuild
# • ⏭️ skipped (disabled)    → Cache not enabled for this run
#
# WHAT IS A PARTIAL HIT?
# GitHub Actions cache supports "restore-keys" - fallback patterns that match
# when the exact key doesn't. Example:
#   key: builtins-Linux-abc123
#   restore-keys: builtins-Linux-
#
# If exact key misses but restore-key matches, GitHub restores an older cache.
# This is useful for caches where old content is better than nothing (like
# builtins - extra extensions don't hurt). We detect and log these partial hits.
#
# SAVE OPERATION LOGGING:
# • 💾 saved                    → Cache was saved successfully
# • ✅ skipped (already cached) → Cache hit during restore, no save needed
# • ⏭️ skipped (not restored)   → Cache not restored, nothing to save
#
# USAGE:
# ./log-cache-status.sh <operation>
#   operation: "restore" or "save"
#
# ENVIRONMENT VARIABLES:
# Set by GitHub Actions workflows (see restore-build-caches/action.yml):
#
# For restore:
#   RESTORE_NPM_CORE, RESTORE_NPM_EXTENSIONS, etc. → "true" if enabled
#   CACHE_NPM_CORE_HIT, CACHE_*_HIT                → "true" if exact key matched
#   CACHE_NPM_CORE_PARTIAL, CACHE_*_PARTIAL        → "true" if restore-key matched
#
# For save:
#   CACHE_NPM_CORE_HIT, CACHE_*_HIT → "true"/"false"/"" (empty = not restored)
#
# ============================================================================

set -euo pipefail

# ============================================================================
# SECTION 1: Validate Arguments
# ============================================================================

OPERATION="${1:-}"

if [[ "$OPERATION" != "restore" && "$OPERATION" != "save" ]]; then
	echo "❌ Error: Invalid operation '$OPERATION'" >&2
	echo "Usage: $0 <restore|save>" >&2
	exit 1
fi

# ============================================================================
# SECTION 2: Logging Functions
# ============================================================================

# ----------------------------------------------------------------------------
# log_restore_status - Show cache restore result
# ----------------------------------------------------------------------------
# Displays one of four states:
# 1. ✅ exact hit   - cache-hit: true (fastest, exact key matched)
# 2. ⚠️ partial hit - cache-hit: false but content exists (restore-key matched)
# 3. ❌ miss        - cache-hit: false and no content (complete miss)
# 4. ⏭️ skipped     - cache restore not enabled for this run
log_restore_status() {
	local cache_name="$1"
	local enabled_var="$2"    # e.g., RESTORE_NPM_CORE
	local hit_var="$3"        # e.g., CACHE_NPM_CORE_HIT
	local partial_var="$4"    # e.g., CACHE_NPM_CORE_PARTIAL

	if [[ "${!enabled_var:-false}" == "true" ]]; then
		if [[ "${!hit_var:-false}" == "true" ]]; then
			# Exact key matched - best case!
			printf "%-16s %s\n" "$cache_name" "✅ hit (exact key)"
		elif [[ "${!partial_var:-false}" == "true" ]]; then
			# restore-key matched - good, but not perfect
			# (cache-hit: false but our detection found content)
			printf "%-16s %s\n" "$cache_name" "⚠️ partial (restore-key)"
		else
			# Complete miss - no cache found at all
			printf "%-16s %s\n" "$cache_name" "❌ miss"
		fi
	else
		# Cache not enabled for this run
		printf "%-16s %s\n" "$cache_name" "⏭️  skipped (disabled)"
	fi
}

# ----------------------------------------------------------------------------
# log_save_status - Show cache save result
# ----------------------------------------------------------------------------
# Displays one of three states:
# 1. 💾 saved       - Cache was saved (only if restore missed)
# 2. ✅ skipped     - Cache hit during restore, no save needed
# 3. ⏭️ skipped     - Cache not restored, nothing to save
log_save_status() {
	local cache_name="$1"
	local hit_var="$2"        # e.g., CACHE_NPM_CORE_HIT

	local hit_status="${!hit_var:-}"

	if [[ "$hit_status" == "false" ]]; then
		# Cache missed during restore, so we saved it
		printf "%-16s %s\n" "$cache_name" "💾 saved"
	elif [[ "$hit_status" == "true" ]]; then
		# Cache hit during restore, no need to save
		printf "%-16s %s\n" "$cache_name" "✅ skipped (already cached)"
	else
		# Cache not restored in this run, nothing to save
		printf "%-16s %s\n" "$cache_name" "⏭️ skipped (not restored)"
	fi
}

# ============================================================================
# SECTION 3: Display Cache Status
# ============================================================================
# Call the appropriate logging function for each cache based on operation.

if [[ "$OPERATION" == "restore" ]]; then
	# ----------------------------------------------------------------------------
	# Restore Operation - Show what was restored
	# ----------------------------------------------------------------------------
	log_restore_status "npm-core"         "RESTORE_NPM_CORE"        "CACHE_NPM_CORE_HIT"                 "CACHE_NPM_CORE_PARTIAL"
	log_restore_status "npm-ext-volatile" "RESTORE_NPM_EXTENSIONS"  "CACHE_NPM_EXTENSIONS_VOLATILE_HIT"  "CACHE_NPM_EXTENSIONS_VOLATILE_PARTIAL"
	log_restore_status "npm-ext-stable"   "RESTORE_NPM_EXTENSIONS"  "CACHE_NPM_EXTENSIONS_STABLE_HIT"    "CACHE_NPM_EXTENSIONS_STABLE_PARTIAL"
	log_restore_status "builtins"         "RESTORE_BUILTINS"        "CACHE_BUILTINS_HIT"                 "CACHE_BUILTINS_PARTIAL"
	log_restore_status "playwright"       "RESTORE_PLAYWRIGHT"      "CACHE_PLAYWRIGHT_HIT"               "CACHE_PLAYWRIGHT_PARTIAL"

elif [[ "$OPERATION" == "save" ]]; then
	# ----------------------------------------------------------------------------
	# Save Operation - Show what was saved
	# ----------------------------------------------------------------------------
	log_save_status "npm-core"         "CACHE_NPM_CORE_HIT"
	log_save_status "npm-ext-volatile" "CACHE_NPM_EXTENSIONS_VOLATILE_HIT"
	log_save_status "npm-ext-stable"   "CACHE_NPM_EXTENSIONS_STABLE_HIT"
	log_save_status "builtins"         "CACHE_BUILTINS_HIT"
	log_save_status "playwright"       "CACHE_PLAYWRIGHT_HIT"
fi

# ============================================================================
# SECTION 4: Job Summary (loud on miss, quiet on hit)
# ============================================================================
# Surface cache state in the GitHub Actions job summary so regressions are
# visible without digging through raw logs. The stable cache miss bug went
# undetected for 20+ days; this is the safety net.
#
# Hit case:     one terse line ("✅ All caches restored").
# Miss case:    "## Cache" section with one bullet per cache showing state.
# Skipped case: one terse line ("⏭️ All caches skipped") if no caches were enabled.
#
# Skipped if $GITHUB_STEP_SUMMARY is unset (local runs).

# Only emit a summary for restore operations, and only when the caller opts in
# via EMIT_CACHE_SUMMARY=true. Cache state is identical across jobs in a
# workflow, so we opt in from one job (test/unit) to avoid duplication.
# Save events are redundant with restore misses (a save only happens because
# the matching restore missed), so we never emit a save summary.
if [[ -z "${GITHUB_STEP_SUMMARY:-}" \
	|| "$OPERATION" != "restore" \
	|| "${EMIT_CACHE_SUMMARY:-false}" != "true" ]]; then
	exit 0
fi

# Map a single cache to "hit" | "partial" | "miss" | "skipped".
cache_state() {
	local enabled_var="$1"
	local hit_var="$2"
	local partial_var="$3"

	if [[ "${!enabled_var:-false}" != "true" ]]; then
		echo "skipped"
	elif [[ "${!hit_var:-false}" == "true" ]]; then
		echo "hit"
	elif [[ "${!partial_var:-false}" == "true" ]]; then
		echo "partial"
	else
		echo "miss"
	fi
}

# Render a cache state as a summary fragment.
render_state() {
	case "$1" in
		hit)     echo "✅ hit" ;;
		partial) echo "⚠️ partial" ;;
		miss)    echo "❌" ;;
		skipped) echo "⏭️ skipped" ;;
		*)       echo "unknown" ;;
	esac
}

# Cache definitions: name | enabled_var | hit_var | partial_var
CACHES=(
	"npm-core|RESTORE_NPM_CORE|CACHE_NPM_CORE_HIT|CACHE_NPM_CORE_PARTIAL"
	"npm-ext-volatile|RESTORE_NPM_EXTENSIONS|CACHE_NPM_EXTENSIONS_VOLATILE_HIT|CACHE_NPM_EXTENSIONS_VOLATILE_PARTIAL"
	"npm-ext-stable|RESTORE_NPM_EXTENSIONS|CACHE_NPM_EXTENSIONS_STABLE_HIT|CACHE_NPM_EXTENSIONS_STABLE_PARTIAL"
	"builtins|RESTORE_BUILTINS|CACHE_BUILTINS_HIT|CACHE_BUILTINS_PARTIAL"
	"playwright|RESTORE_PLAYWRIGHT|CACHE_PLAYWRIGHT_HIT|CACHE_PLAYWRIGHT_PARTIAL"
)

# Compute state per cache and count categories.
states=()
total=0
exact_hits=0
partial_hits=0
misses=0
for spec in "${CACHES[@]}"; do
	IFS='|' read -r name enabled_var hit_var partial_var <<< "$spec"
	state="$(cache_state "$enabled_var" "$hit_var" "$partial_var")"
	states+=("$name|$state")

	if [[ "$state" != "skipped" ]]; then
		total=$((total + 1))
	fi
	case "$state" in
		hit)     exact_hits=$((exact_hits + 1)) ;;
		partial) partial_hits=$((partial_hits + 1)) ;;
		miss)    misses=$((misses + 1)) ;;
	esac
done

# Emit summary.
{
	if [[ "$total" -eq 0 ]]; then
		echo "⏭️ All caches skipped"
	elif [[ "$misses" -eq 0 ]]; then
		if [[ "$partial_hits" -gt 0 ]]; then
			echo "✅ All caches restored (${exact_hits} exact, ${partial_hits} partial)"
		else
			echo "✅ All caches restored (${exact_hits}/${total})"
		fi
	else
		echo "## Cache"
		echo ""
		for entry in "${states[@]}"; do
			IFS='|' read -r name state <<< "$entry"
			echo "- ${name} $(render_state "$state")"
		done
	fi
	echo ""
} >> "$GITHUB_STEP_SUMMARY"
