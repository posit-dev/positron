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

# --- Start Positron ---

# note that some tests from upstream have been deleted at this location
# those tests are now in test-integration-nightly.sh

# --- End Positron ---

if [ -z "$INTEGRATION_TEST_APP_NAME" ]; then
	kill_app() { true; }
else
	kill_app() { killall $INTEGRATION_TEST_APP_NAME || true; }
fi

# --- Start Positron ---

# note that some tests from upstream have been deleted at this location
# those tests are now in test-integration-nightly.sh

# Positron Extensions

echo
echo "### Positron Code Cells tests"
echo
yarn test-extension -l positron-code-cells
kill_app

echo
echo "### Positron R tests"
echo
yarn test-extension -l positron-r
kill_app

# note that some tests from upstream have been deleted at this location
# those tests are now in test-integration-nightly.sh

# --- End Positron ---

# Cleanup

rm -rf $VSCODEUSERDATADIR
