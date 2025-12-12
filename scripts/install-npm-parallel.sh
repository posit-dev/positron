#!/usr/bin/env bash
set -e

# install-npm-parallel.sh
# Installs npm dependencies in parallel for root, build, remote, and test/e2e directories.
# This script is used by CI workflows to speed up dependency installation.

# Ensure npm cache dir exists. The composite action should set NPM_CONFIG_CACHE.
NPM_CONFIG_CACHE=${NPM_CONFIG_CACHE:-.npm-cache}
mkdir -p "$NPM_CONFIG_CACHE"

echo "Installing npm dependencies in parallel using cache: $NPM_CONFIG_CACHE"

# Run all npm ci commands in parallel for faster installation
pids=()
npm ci --prefer-offline --no-audit --no-fund --fetch-timeout 120000 --cache "$NPM_CONFIG_CACHE" & pids+=($!)
npm --prefix build ci --prefer-offline --no-audit --no-fund --fetch-timeout 120000 --cache "$NPM_CONFIG_CACHE" & pids+=($!)
npm --prefix remote ci --prefer-offline --no-audit --no-fund --fetch-timeout 120000 --cache "$NPM_CONFIG_CACHE" & pids+=($!)
npm --prefix test/e2e ci --prefer-offline --no-audit --no-fund --fetch-timeout 120000 --cache "$NPM_CONFIG_CACHE" & pids+=($!)

# Wait for all npm ci processes and check exit codes
exit_code=0
for pid in "${pids[@]}"; do
	if ! wait "$pid"; then
		exit_code=1
	fi
done

if [ $exit_code -ne 0 ]; then
	echo "One or more npm ci commands failed"
	exit 1
fi

echo "All npm ci commands completed successfully"
