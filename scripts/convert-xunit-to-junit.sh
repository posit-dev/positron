#!/bin/bash

# Input and output file paths
XUNIT_FILE="./.build/logs/smoke-tests-electron/test-results/xunit-results.xml"
JUNIT_FILE="./.build/logs/smoke-tests-electron/test-results/results.xml"

# Create the output directory if it doesn't exist
OUTPUT_DIR=$(dirname "$JUNIT_FILE")
mkdir -p "$OUTPUT_DIR"

# Check if xUnit XML file exists
if [ ! -f "$XUNIT_FILE" ]; then
    echo "xUnit file $XUNIT_FILE not found!"
    exit 1
fi

# Create a JUnit XML structure from xUnit
echo '<?xml version="1.0" encoding="UTF-8"?>' > "$JUNIT_FILE"
echo '<testsuites name="test suites root">' >> "$JUNIT_FILE"

# Extract each <testsuite> and handle it individually
/usr/bin/xmllint --xpath '//*[local-name()="testsuite"]' "$XUNIT_FILE" | while read -r testsuite; do
    # Extract the <testsuite> and its content
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

    # Extract and add the <testcase> elements for this <testsuite>
    /usr/bin/xmllint --xpath '//*[local-name()="testcase"]' "$XUNIT_FILE" | awk '
    {
        gsub(/<testcase/, "<testcase");
        gsub(/classname=/, "classname=");
        gsub(/name=/, "name=");
        gsub(/time=/, "time=");
        print $0;
    }' >> "$JUNIT_FILE"

    # Close the current <testsuite>
    echo '</testsuite>' >> "$JUNIT_FILE"
done

# Close the <testsuites> block
echo '</testsuites>' >> "$JUNIT_FILE"

echo "Conversion complete. JUnit XML saved to: $JUNIT_FILE"
