#!/usr/bin/env bash
set -e

if [[ "$OSTYPE" == "darwin"* ]]; then
	realpath() { [[ $1 = /* ]] && echo "$1" || echo "$PWD/${1#./}"; }
	ROOT=$(dirname $(dirname $(realpath "$0")))
else
	ROOT=$(dirname $(dirname $(readlink -f $0)))
	# --disable-dev-shm-usage: when run on docker containers where size of /dev/shm
	# partition < 64MB which causes OOM failure for chromium compositor that uses the partition for shared memory
	LINUX_EXTRA_ARGS="--disable-dev-shm-usage"
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

echo
echo "### Positron Assistant tests"
echo
npm run test-extension -- -l positron-assistant
kill_app

echo
echo "### Positron Catalog Explorer tests"
echo
npm run test-extension -- -l positron-catalog-explorer
kill_app

echo
echo "### Positron Code Cells tests"
echo
npm run test-extension -- -l positron-code-cells
kill_app

echo
echo "### Positron R tests"
echo
npm run test-extension -- -l positron-r
kill_app

echo
echo "### Positron R connections tests"
echo
npm run test-extension -- -l positron-connections
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
npm run test-extension -- -l positron-duckdb
kill_app

echo
echo "### Positron Zed tests"
echo
npm run test-extension -- -l positron-zed
kill_app

# Cleanup

rm -rf $VSCODEUSERDATADIR
