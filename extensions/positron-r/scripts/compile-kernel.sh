#!/usr/bin/env bash

# Test to see whether the rust compiler is installed
if ! command -v cargo &> /dev/null
then
	echo "Can't find 'cargo' command; skipping build of Amalthea kernel."
	exit
fi

# Enter the kernel directory (it's a sibling subdirectory of this one)
SCRIPTDIR=$(cd "$(dirname -- "${BASH_SOURCE[0]}")"; pwd -P)
pushd "${SCRIPTDIR}/../amalthea"

# Build the kernel
cargo build

popd

