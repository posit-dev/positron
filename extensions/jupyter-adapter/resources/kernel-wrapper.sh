#!/usr/bin/env bash

# ---------------------------------------------------------------------------------------------
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
# ---------------------------------------------------------------------------------------------

# This script is used to run a program and capture its output to a file. It is
# used to capture the output of the kernel process so that it can be displayed
# in the UI in the case of a startup failure; it may also be used in the future
# to perform Positron-specific kernel startup routines, such as setting up
# environment variables.

# Check that the user provided at least two arguments; the first is the output
# file and the second is the program to run and any arguments. If not, print a
# usage message and exit with an error code.
if [ $# -lt 2 ]; then
  echo "Usage: $0 <output-file> <program> [program-args...]" >&2
  exit 1
fi

# The first argument is the output file; consume it.
output_file="$1"
shift

# If the POSITRON_DYLD_FALLBACK_LIBRARY_PATH environment variable is set, then
# set it as the DYLD_FALLBACK_LIBRARY_PATH environment variable for the program
# we are about to run. This is a workaround for behavior on macOS wherein SIP
# prevents DYLD_FALLBACK_LIBRARY_PATH from being inherited.
if [ -n "$POSITRON_DYLD_FALLBACK_LIBRARY_PATH" ]; then
	export DYLD_FALLBACK_LIBRARY_PATH="$POSITRON_DYLD_FALLBACK_LIBRARY_PATH"
fi

# Run the program with its arguments, redirecting stdout and stderr to the output file
"$@" > "$output_file" 2>&1

# Save the exit code of the program
exit_code=$?

# Exit with the same code as the program so that the caller can correctly report errors
exit $exit_code
