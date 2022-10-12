#!/usr/bin/env sh

# Make sure that zmq produces arm64 builds where appropriate
if [ "$(uname -sm)" = "Darwin arm64" ]; then
	export CMAKE_OSX_ARCHITECTURES="arm64"
fi

# Ensure that zeromq is built against the right version of node
electron-rebuild zeromq "$@"

