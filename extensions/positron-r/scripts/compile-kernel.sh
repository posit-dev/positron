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
	# Allow cross-compilation in pkg-config. Needed to compile native code in rust-zmq.
	export PKG_CONFIG_ALLOW_CROSS=1

	# Set the target triple. Note that this requires the machine doing the compilation
	# to have the appropriate cross-compilation toolchain installed.
	#
	# For example, to add both x86_64 and aarch64 targets, run:
	#
	#   $ rustup target add aarch64-apple-darwin x86_64-apple-darwin
	#
	CARGO_TARGET="--target ${RUST_TARGET}"
fi

# Build the kernel!
cargo build ${CARGO_TARGET}

# If we built a cross-compiled version of the ark kernel, copy it to the right
# place; it is always expected in target/debug.
if [ -n "${RUST_TARGET}" ]; then
	mkdir -p "target/debug"
	cp "target/${RUST_TARGET}/debug/ark" "target/debug/ark"
fi

popd

