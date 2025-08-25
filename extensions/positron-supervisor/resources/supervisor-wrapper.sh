#!/usr/bin/env bash

# ---------------------------------------------------------------------------------------------
# Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

# This script is used to run a program and capture its output to a file. It is
# used to capture the output of the supervisor process so that it can be displayed
# in the UI in the case of a startup failure

# Check that the user provided at least two arguments; the first is the output
# file and the second is the program to run and any arguments. If not, print a
# usage message and exit with an error code.
if [ $# -lt 2 ]; then
	echo "Usage: $0 <output-file> <program> [program-args...]" >&2
	echo "       $0 nohup <output-file> <program> [program-args...]" >&2
	exit 1
fi

# Check if the first argument is "nohup". If it is, we'll run the supervisor
# process with nohup, rather than running it directly. This is used to prevent
# the supervisor from exiting when Positron does when the user has configured
# the supervisor to run in the background.
use_nohup=false
if [ "$1" = "nohup" ]; then
	use_nohup=true
	shift

	# After shifting, make sure we still have enough arguments
	if [ $# -lt 2 ]; then
		echo "Usage: $0 nohup <output-file> <program> [program-args...]" >&2
		exit 1
	fi
fi

# The first argument is the output file; consume it.
output_file="$1"
shift

# Get the user's default shell. We run the program in a login shell to allow for
# startup and environment variable customization in e.g. .bash_profile
DEFAULT_SHELL=$SHELL

# If $SHELL is not set, try to use the environment
if [ -z "$DEFAULT_SHELL" ]; then
    # Fall back to bash as a reasonable default
    DEFAULT_SHELL=$(which bash 2>/dev/null || which sh)
fi

# Ensure we have a valid shell
if [ -z "$DEFAULT_SHELL" ] || [ ! -x "$DEFAULT_SHELL" ]; then
    echo "Error: Could not determine a valid shell." >&2
    exit 1
fi

# Determine shell flags based on shell type
# csh and tcsh don't support -l and -c together; use -d instead of -l
# (in csh, -d loads the directory stack even in non-login shells)
SHELL_NAME=$(basename "$DEFAULT_SHELL")
if [ "$SHELL_NAME" = "csh" ] || [ "$SHELL_NAME" = "tcsh" ]; then
    SHELL_FLAGS="-d -c"
else
    SHELL_FLAGS="-l -c"
fi

# Print the command line to the log file
echo "$DEFAULT_SHELL" $SHELL_FLAGS "$@" >> "$output_file"

# Quote the arguments to handle single quotes and spaces correctly
QUOTED_ARGS=""
for arg in "$@"; do
    # Escape any single quotes in the argument
    escaped_arg=$(printf "%s" "$arg" | sed "s/'/'\\\\''/g")
    # Add the escaped argument with single quotes
    QUOTED_ARGS="${QUOTED_ARGS} '${escaped_arg}'"
done

# Run the program with its arguments, redirecting stdout and stderr to the output file
if [ "$use_nohup" = true ]; then
	# Use nohup and explicitly redirect its output to prevent nohup.out from being created
	nohup $DEFAULT_SHELL $SHELL_FLAGS "${QUOTED_ARGS}" >> "$output_file" 2>&1 &
	# Wait for the background process to complete
	wait $!
else
	$DEFAULT_SHELL $SHELL_FLAGS "${QUOTED_ARGS}" >> "$output_file" 2>&1
fi

# Save the exit code of the program
exit_code=$?

# Exit with the same code as the program so that the caller can correctly report errors
exit $exit_code
