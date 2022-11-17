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

# If RUST_TARGET is set, forward its value to cargo. We do this in order to
# cross-compile an x86_64 version of the kernel on an ARM64 (Apple Silicon)
# machine.
if [ -n "${RUST_TARGET}" ]; then
	CARGO_TARGET="--target ${RUST_TARGET}"
fi

# Build the kernel
cargo build ${CARGO_TARGET}

popd

