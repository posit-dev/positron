#!/bin/bash

# Check if a directory name was passed as a parameter
if [ -z "$1" ]; then
	echo "No directory specified. Usage: sh ./scripts/convert-xunit-to-junit.sh <directory>"
	exit 1
fi

# Assign the directory parameter
DIR_NAME="$1"

# Input and output file paths, dynamically using the specified directory
XUNIT_FILE="./.build/logs/$DIR_NAME/test-results/xunit-results.xml"
CLEAN_XUNIT_FILE="./.build/logs/$DIR_NAME/test-results/xunit-results-clean.xml"
JUNIT_FILE="./.build/logs/$DIR_NAME/test-results/results.xml"

# Create the output directory if it doesn't exist
OUTPUT_DIR=$(dirname "$JUNIT_FILE")
mkdir -p "$OUTPUT_DIR"

# Check if XUnit XML file exists
if [ ! -f "$XUNIT_FILE" ]; then
	echo "XUnit file $XUNIT_FILE not found!"
	exit 1
fi

# Check if the XUnit XML file is empty
if [ ! -s "$XUNIT_FILE" ]; then
	echo "Error: XUnit file $XUNIT_FILE exists but is empty!"
	exit 1
fi

# When we started logging stack traces in middle of test results ANSI escape codes were added to the XML file
# These escape codes are not valid XML and cause xmllint to fail. So we need to strip them out.
# - `&#x1B;` sequences represent ANSI escape codes in XML (used for colors and formatting).
# - `\u001b` is the raw representation of the escape code in other formats.
# Create a cleaned copy of the input file without escape sequences.
sed -E 's/&#x1B;\[[0-9;]*[a-zA-Z]//g' "$XUNIT_FILE" | sed -E 's/\u001b\[[0-9;]*[a-zA-Z]//g' > "$CLEAN_XUNIT_FILE"

# Validate the input XML file format before proceeding
if ! /usr/bin/xmllint --noout "$CLEAN_XUNIT_FILE" 2>/dev/null; then
	echo "Error: $CLEAN_XUNIT_FILE is not a well-formed XML file."
	exit 1
fi

# Create a JUnit XML structure from XUnit
echo '<?xml version="1.0" encoding="UTF-8"?>' > "$JUNIT_FILE"
echo '<testsuites name="test suites root">' >> "$JUNIT_FILE"

# Extract the entire <testsuite> block from the XUnit file
TESTSUITE=$(/usr/bin/xmllint --xpath '//*[local-name()="testsuite"]' "$CLEAN_XUNIT_FILE" 2>/dev/null)

# If no <testsuite> elements were found, output an error and exit
if [ -z "$TESTSUITE" ]; then
	echo "Error: No <testsuite> elements found in the XUnit file."
	exit 1
fi

# Debug: Print the entire <testsuite> content
# echo "Extracted <testsuite> content:"
# echo "$TESTSUITE"

# Extract the opening <testsuite> tag and its attributes
TESTSUITE_OPENING=$(echo "$TESTSUITE" | sed -n 's/^\(<testsuite[^>]*>\).*/\1/p')

# If a valid opening tag is found, proceed
if [ -n "$TESTSUITE_OPENING" ]; then
	# Add the <testsuite> opening tag to the JUnit file
	echo "$TESTSUITE_OPENING" >> "$JUNIT_FILE"

	# Extract and add the <testcase> elements for this <testsuite>
	# This will capture all the nested <testcase> elements correctly
	TESTCASES=$(echo "$TESTSUITE" | xmllint --xpath '//*[local-name()="testcase"]' - 2>/dev/null)

	# Debug: Print the extracted <testcase> elements
	# echo "Extracted testcases:"
	# echo "$TESTCASES"

	# Add the <testcase> elements to the JUnit file
	if [ -n "$TESTCASES" ]; then
		echo "$TESTCASES" | sed 's#<testcase \(.*\)\/>#<testcase \1></testcase>#g' >> "$JUNIT_FILE"
	else
		echo "Warning: No <testcase> elements found in this testsuite."
	fi

	# Close the <testsuite> tag after processing its test cases
	echo '</testsuite>' >> "$JUNIT_FILE"
else
	echo "Error: Malformed testsuite element."
	exit 1
fi

# Close the <testsuites> root element
echo '</testsuites>' >> "$JUNIT_FILE"

# Detect if running on macOS (BSD) or Linux and adjust sed accordingly
case "$OSTYPE" in
	darwin*)
		# macOS/BSD sed: use -i '' for in-place edits
		sed -i '' -e 's#<skipped></testcase>#<skipped />#g' "$JUNIT_FILE"
		;;
	*)
		# Linux/GNU sed: use -i without ''
		sed -i 's#<skipped></testcase>#<skipped />#g' "$JUNIT_FILE"
		;;
esac

echo "Conversion complete. JUnit XML saved to: $JUNIT_FILE"
