#!/usr/bin/env bash

if [[ "$OSTYPE" == "darwin"* ]]; then
	realpath() { [[ $1 = /* ]] && echo "$1" || echo "$PWD/${1#./}"; }
	ROOT=$(dirname $(dirname $(realpath "$0")))
else
	ROOT=$(dirname $(dirname $(readlink -f $0)))
fi

function code() {
	pushd $ROOT

	# Get electron, compile, built-in extensions
	if [[ -z "${VSCODE_SKIP_PRELAUNCH}" ]]; then
		node build/lib/preLaunch.ts
	fi

	NODE=$(node build/lib/node.ts)
	if [ ! -e $NODE ];then
		# Load remote node
		npm run gulp node
	fi

	popd

	# --- Start Positron ---
	# The vscode.vscode-api-tests extension takes over the default chat
	# provider in order to test the chat feature. We disable the extension in
	# server dev mode so that Positron Assistant can become the default chat
	# provider.
	DISABLE_TEST_EXTENSION="--disable-extension=vscode.vscode-api-tests"
	if [[ "$@" == *"--extensionTestsPath"* ]]; then
		DISABLE_TEST_EXTENSION=""
	fi

	# Modified from upstream to add DISABLE_TEST_EXTENSION
	NODE_ENV=development \
	VSCODE_DEV=1 \
	$NODE $ROOT/scripts/code-server.js "$@" $DISABLE_TEST_EXTENSION
	# --- End Positron ---
}

code "$@"
