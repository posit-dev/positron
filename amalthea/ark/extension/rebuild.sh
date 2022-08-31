#!/usr/bin/env bash

set -e

# A helper script, for quickly rebuilding and reinstalling the ark extension.

mkdir -p package
echo "[i] Building ark extension"
vsce package --out package/ || {
	echo "Error: packaging extension failed [error code $?]"
	exit 1
}

# Try to find the 'code' executable.
if [ -z "${CODE}" ]; then

	if [ "$(uname)" = "Darwin" ]; then
		CODE="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
	fi

fi

if ! [ -f "${CODE}" ]; then
	echo "Error: could not find 'code' executable; extension will not be installed."
	exit 1
fi

echo "[i] Installing ark extension"
"${CODE}" --install-extension *.vsix || {
	echo "Error: installing extension failed [error code $?]"
	exit 1
}

