#!/usr/bin/env bash

set -e

# A helper script, for quickly rebuilding and reinstalling the ark extension.

mkdir -p package
echo "[i] Building ark extension"
vsce package --out package/ || {
	echo "Error: packaging extension failed [error code $?]"
	exit 1
}

