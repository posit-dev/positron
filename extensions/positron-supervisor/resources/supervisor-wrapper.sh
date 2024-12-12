#!/usr/bin/env bash

# ---------------------------------------------------------------------------------------------
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
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
	exit 1
fi

# The first argument is the output file; consume it.
output_file="$1"
shift

# Print the command line to the log file
echo "$@" >> "$output_file"

# Run the program with its arguments, redirecting stdout and stderr to the output file
"$@" >> "$output_file" 2>&1

# Save the exit code of the program
exit_code=$?

# Exit with the same code as the program so that the caller can correctly report errors
exit $exit_code
