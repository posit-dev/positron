#!/usr/bin/env bash

# replace-license.sh
#
# Copyright (c) 2024 Posit Software, PBC. All rights reserved.
#
# This script replaces an embedded, PKCS8 encoded public key in a code file
# with a new public key from a license file. The script looks for the public
# key using the BEGIN/END key markers, and inserts the contents of the license
# file between the markers.
#
# Usage: replace-license.sh <code_file> <license_file>
#
#

# Check if both files are provided as arguments
if [ "$#" -ne 2 ]; then
    echo "Usage: $0 code_file license_file"
    exit 1
fi

code_file="$1"
license_file="$2"

# Check if code_file and license_file exist
if [ ! -f "$code_file" ] || [ ! -f "$license_file" ]; then
    echo "Both the code file and the license file must exist."
    exit 1
fi

# Initialize variables
output=""
inside_markers=false

# Read license file content for replacement
replacement_content=$(<"$license_file")

# Read through code_file line-by-line
while IFS= read -r line; do
    # Check if we're entering the marker area
    if [[ "$line" == *"-----BEGIN PUBLIC KEY-----"* && "$inside_markers" == false ]]; then
        # Capture content before the marker and start replacement
        prefix="${line%%-----BEGIN PUBLIC KEY-----*}"
        output+="$prefix"
        output+="$replacement_content"$'\n'
        inside_markers=true
        continue
    fi

    # Check if we're exiting the marker area
    if [[ "$line" == *"-----END PUBLIC KEY-----"* && "$inside_markers" == true ]]; then
        # Capture content after the marker
        suffix="${line##*-----END PUBLIC KEY-----}"
        output+="$suffix"
        inside_markers=false
        continue
    fi


    # If we're not between markers, add line as-is
    if [ "$inside_markers" = false ]; then
        output+="$line"$'\n'
    fi

done < "$code_file"

# Write the modified content back to code_file
echo "$output" > "$code_file"

echo "License replacement complete."
