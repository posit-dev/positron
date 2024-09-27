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
JUNIT_FILE="./.build/logs/$DIR_NAME/test-results/results.xml"

# Create the output directory if it doesn't exist
OUTPUT_DIR=$(dirname "$JUNIT_FILE")
mkdir -p "$OUTPUT_DIR"

# Check if XUnit XML file exists
if [ ! -f "$XUNIT_FILE" ]; then
	echo "XUnit file $XUNIT_FILE not found!"
	exit 1
fi

# Check if the Xunit XML file is empty
if [ ! -s "$XUNIT_FILE" ]; then
	echo "Error: Xunit file $XUNIT_FILE exists but is empty!"
	exit 1
fi

# Create a JUnit XML structure from XUnit
echo '<?xml version="1.0" encoding="UTF-8"?>' > "$JUNIT_FILE"
echo '<testsuites name="test suites root">' >> "$JUNIT_FILE"

# Extract each <testsuite> element and its content
/usr/bin/xmllint --xpath '//*[local-name()="testsuite"]' "$XUNIT_FILE" | while read -r testsuite; do
	# Check if the current line is an opening <testsuite> tag
	if echo "$testsuite" | grep -q "<testsuite"; then
		# Extract and format the <testsuite> attributes
		echo "$testsuite" | awk '
		{
			gsub(/<testsuite/, "<testsuite");
			gsub(/name=/, "name=");
			gsub(/tests=/, "tests=");
			gsub(/failures=/, "failures=");
			gsub(/errors=/, "errors=");
			gsub(/time=/, "time=");
			gsub(/timestamp=/, "timestamp=");
			print $0;
		}' >> "$JUNIT_FILE"
	fi

	# Extract and add the <testcase> elements for this <testsuite>
	/usr/bin/xmllint --xpath '//*[local-name()="testcase"]' "$XUNIT_FILE" | sed 's#<testcase \(.*\)\/>#<testcase \1></testcase>#' >> "$JUNIT_FILE"

	# Close the <testsuite> tag only if there was an opening <testsuite> tag
	if echo "$testsuite" | grep -q "</testsuite>"; then
		echo '</testsuite>' >> "$JUNIT_FILE"
	fi
done

# Close the <testsuites> block
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
