#!/usr/bin/env bash
# Audit the runtime npm dependencies of the projects that Positron owns and
# print a Markdown report on stdout. The project list lives in
# .github/dependency-audit-manifests.txt; the weekly workflow
# (dependency-audit-weekly.yml) runs this with --fix --snyk and opens a PR with
# the lockfile changes.
#
# Usage: scripts/dependency-audit.sh [--fix] [--snyk] [--manifests FILE]
#   --fix:       run `npm audit fix --package-lock-only --omit=dev` in each
#                project first. This edits package-lock.json in place, staying
#                inside the semver ranges in package.json (no --force), so it
#                fixes transitive advisories that need only a lockfile refresh.
#   --snyk:      also run `snyk test` on each lockfile (after any fix), so the
#                report shows what the security team sees in Snyk. Needs the
#                snyk CLI on PATH and SNYK_TOKEN in the environment.
#   --manifests: project list to read (default
#                .github/dependency-audit-manifests.txt).
#
# Run from the repo root. Exits 0 even when advisories remain: the report is the
# result. Exits 2 on bad arguments or a missing project list.
set -uo pipefail

FIX=false
SNYK=false
MANIFESTS=.github/dependency-audit-manifests.txt
while [ $# -gt 0 ]; do
	case "$1" in
		--fix) FIX=true ;;
		--snyk) SNYK=true ;;
		--manifests) MANIFESTS="$2"; shift ;;
		*) echo "Unknown argument: $1" >&2; exit 2 ;;
	esac
	shift
done

if [ ! -f "$MANIFESTS" ]; then
	echo "Project list not found: $MANIFESTS" >&2
	exit 2
fi

# Extensions install with legacy-peer-deps (extensions/.npmrc, applied by
# build/npm/postinstall.ts). Without it, `npm audit fix` can stop with ERESOLVE
# on peer conflicts that a normal install accepts.
export npm_config_legacy_peer_deps=true

# Prints "<critical> <high> <total>|<comma-separated high/critical packages>"
# for the runtime dependencies of project $1, or nothing if npm audit failed.
npm_audit() {
	(cd "$1" && npm audit --package-lock-only --omit=dev --json 2>/dev/null) |
		jq -r '
			select(.metadata.vulnerabilities) |
			(.metadata.vulnerabilities | "\(.critical) \(.high) \(.total)") + "|" +
			([.vulnerabilities[] | select(.severity == "critical" or .severity == "high") | .name] | join(", "))
		' 2>/dev/null
}

# Prints "<critical> <high> <total>" from `snyk test` for project $1, or nothing
# if Snyk failed. Snyk excludes dev dependencies by default. One advisory can
# reach a package through several paths, so count unique advisory IDs.
snyk_audit() {
	# snyk exits 1 when it finds issues, so ignore its status and read the JSON.
	(cd "$1" && snyk test --file=package-lock.json --json 2>/dev/null) |
		jq -r '
			select(.error | not) |
			[.vulnerabilities // [] | unique_by(.id)[]] |
			"\(map(select(.severity == "critical")) | length) \(map(select(.severity == "high")) | length) \(length)"
		' 2>/dev/null
}

# "<critical> <high> <total>" -> "C / H / total" for the table.
fmt() {
	if [ -z "$1" ]; then
		echo "error"
	else
		read -r c h t <<< "$1"
		echo "$c/$h/$t"
	fi
}

rows=()
clean=0
errors=()

while IFS= read -r dir || [ -n "$dir" ]; do
	dir="${dir%%#*}"
	dir="$(echo "$dir" | xargs)"
	[ -z "$dir" ] && continue

	if [ ! -f "$dir/package-lock.json" ]; then
		errors+=("\`$dir\`: no package-lock.json")
		continue
	fi
	echo "Auditing $dir" >&2

	before="$(npm_audit "$dir")"
	before_counts="${before%%|*}"

	after="$before"
	# Skip clean projects: npm audit fix can still rewrite their lockfiles
	# (format or extraneous-entry churn), which only adds noise to the PR.
	if [ "$FIX" = true ] && [ -n "$before_counts" ] && [ "$before_counts" != "0 0 0" ]; then
		if ! (cd "$dir" && npm audit fix --package-lock-only --omit=dev >/dev/null 2>&1); then
			# npm audit fix exits non-zero when some advisories need a manual
			# (semver-major) fix; that's expected, so this is only a note.
			echo "  npm audit fix left advisories in $dir" >&2
		fi
		after="$(npm_audit "$dir")"
	fi
	after_counts="${after%%|*}"
	remaining="${after#*|}"

	snyk_counts=""
	if [ "$SNYK" = true ]; then
		snyk_counts="$(snyk_audit "$dir")"
		[ -z "$snyk_counts" ] && errors+=("\`$dir\`: snyk test failed")
	fi

	if [ -z "$before_counts" ] || [ -z "$after_counts" ]; then
		errors+=("\`$dir\`: npm audit failed")
	fi

	# Leave clean projects out of the table so the report stays short.
	if [ "$before_counts" = "0 0 0" ] && [ "$after_counts" = "0 0 0" ] &&
		{ [ "$SNYK" = false ] || [ "$snyk_counts" = "0 0 0" ]; }; then
		clean=$((clean + 1))
		continue
	fi

	row="| ${dir#extensions/} | $(fmt "$before_counts")"
	[ "$FIX" = true ] && row="$row | $(fmt "$after_counts")"
	[ "$SNYK" = true ] && row="$row | $(fmt "$snyk_counts")"
	row="$row | ${remaining:-none} |"
	rows+=("$row")
done < "$MANIFESTS"

echo "## Dependency audit: runtime dependencies"
echo ""
echo "Projects are under \`extensions/\`. Counts are critical/high/all advisories, from \`npm audit --omit=dev\`$( [ "$SNYK" = true ] && echo " and \`snyk test\`" )."
if [ "$FIX" = true ]; then
	echo "\"After fix\" is npm audit after \`npm audit fix --package-lock-only --omit=dev\`. \"Needs manual fix\" lists packages that still have a high or critical advisory after the fix, which usually need a semver-major bump or an \`overrides\` entry."
fi
echo ""
if [ ${#rows[@]} -gt 0 ]; then
	header="| Project"
	divider="|---"
	if [ "$FIX" = true ]; then
		header="$header | Before | After fix"
		divider="$divider|---|---"
	else
		header="$header | npm audit"
		divider="$divider|---"
	fi
	[ "$SNYK" = true ] && header="$header | Snyk" && divider="$divider|---"
	echo "$header | Needs manual fix |"
	echo "$divider|---|"
	printf '%s\n' "${rows[@]}"
	echo ""
fi
echo "$clean other projects have no advisories."
if [ ${#errors[@]} -gt 0 ]; then
	echo ""
	echo "### Errors"
	echo ""
	printf -- '- %s\n' "${errors[@]}"
fi
