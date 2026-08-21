#!/usr/bin/env bash
set -e

if [[ "$OSTYPE" == "darwin"* ]]; then
	realpath() { [[ $1 = /* ]] && echo "$1" || echo "$PWD/${1#./}"; }
	ROOT=$(dirname $(dirname $(realpath "$0")))
else
	ROOT=$(dirname $(dirname $(readlink -f $0)))
	# --no-sandbox: chrome-sandbox requires SUID root on Linux CI runners
	# --disable-dev-shm-usage: when run on docker containers where size of /dev/shm
	# partition < 64MB which causes OOM failure for chromium compositor that uses the partition for shared memory
	LINUX_EXTRA_ARGS="--no-sandbox --disable-dev-shm-usage"
fi

VSCODEUSERDATADIR=`mktemp -d 2>/dev/null`
VSCODECRASHDIR=$ROOT/.build/crashes
VSCODELOGSDIR=$ROOT/.build/logs/integration-tests

cd $ROOT

# Figure out which Electron to use for running tests
if [ -z "$INTEGRATION_TEST_ELECTRON_PATH" ]
then
	INTEGRATION_TEST_ELECTRON_PATH="./scripts/code.sh"

	echo "Running integration tests out of sources."
else
	export VSCODE_CLI=1
	export ELECTRON_ENABLE_LOGGING=1

	echo "Running integration tests with '$INTEGRATION_TEST_ELECTRON_PATH' as build."
fi

echo "Storing crash reports into '$VSCODECRASHDIR'."
echo "Storing log files into '$VSCODELOGSDIR'."


if [ -z "$INTEGRATION_TEST_APP_NAME" ]; then
	kill_app() { true; }
else
	kill_app() { killall $INTEGRATION_TEST_APP_NAME || true; }
fi

# --- Start Positron ---
# Retry wrapper for the suites launched through `vscode-test`. Headless Electron
# intermittently GP-faults during startup, in libexpat while fontconfig
# initializes fonts on a worker thread (stack: libexpat <- libfontconfig <-
# libpangoft2), before any test runs. `npm run test-extension` swallows the
# child's 139 and exits 1, so the exit code alone cannot identify it -- match on
# the crash line `vscode-test` prints instead. Anything else is a real test
# failure and is returned immediately so it is never masked. Mirrors
# `run_extension_suite` in test-integration.sh.
run_extension_suite() {
	local attempt=1 max_attempts=3 status log
	log=$(mktemp)
	while true; do
		set +e
		"$@" 2>&1 | tee "$log"
		status=${PIPESTATUS[0]}
		set -e
		if [ "$status" -eq 0 ] || [ "$attempt" -ge "$max_attempts" ] || ! grep -qE "Exit code: +(SIGSEGV|139)" "$log"; then
			rm -f "$log"
			return "$status"
		fi
		echo "Electron exited with a startup segfault (likely the fontconfig race); retrying (attempt $((attempt + 1))/$max_attempts)..."
		kill_app
		attempt=$((attempt + 1))
	done
}
# --- End Positron ---

echo
echo "### Authentication tests"
echo
run_extension_suite npm run test-extension -- -l authentication
kill_app

echo
echo "### Positron Catalog Explorer tests"
echo
run_extension_suite npm run test-extension -- -l positron-catalog-explorer
kill_app

echo
echo "### Positron Code Cells tests"
echo
run_extension_suite npm run test-extension -- -l positron-code-cells
kill_app

echo
echo "### Positron Skills tests"
echo
run_extension_suite npm run test-extension -- -l positron-skills
kill_app

echo
echo "### Next Edit Suggestions tests"
echo
run_extension_suite npm run test-extension -- -l next-edit-suggestions
kill_app

echo
echo "### Positron R tests"
echo
run_extension_suite npm run test-extension -- -l positron-r
kill_app

echo
echo "### Positron R connections tests"
echo
run_extension_suite npm run test-extension -- -l positron-connections
kill_app

# Disabling Positron Run App tests for now as they are flaky
# echo
# echo "### Positron Run App tests"
# echo
# npm run test-extension -- -l positron-run-app
# kill_app

echo
echo "### Positron DuckDB tests"
echo
run_extension_suite npm run test-extension -- -l positron-duckdb
kill_app

echo
echo "### Positron DuckDB data connection tests"
echo
run_extension_suite npm run test-extension -- -l positron-data-driver-duckdb
kill_app

echo
echo "### Positron SQLite data connection tests"
echo
run_extension_suite npm run test-extension -- -l positron-data-driver-sqlite
kill_app

echo
echo "### Positron Databricks data connection tests"
echo
run_extension_suite npm run test-extension -- -l positron-data-driver-databricks
kill_app

echo
echo "### Positron Connect Pins data connection tests"
echo
run_extension_suite npm run test-extension -- -l positron-data-driver-pins
kill_app

echo
echo "### Positron Zed tests"
echo
run_extension_suite npm run test-extension -- -l positron-zed
kill_app

# Cleanup

rm -rf $VSCODEUSERDATADIR
