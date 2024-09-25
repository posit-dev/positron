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

# Debugging: Print xUnit file contents (optional)
# cat "$XUNIT_FILE"

# Create a JUnit XML structure from xUnit
echo '<?xml version="1.0" encoding="UTF-8"?>' > "$JUNIT_FILE"
echo '<testsuites name="test suites root">' >> "$JUNIT_FILE"

# Extract the <testsuite> attributes and transform them to JUnit format
/usr/bin/xmllint --xpath '//*[local-name()="testsuite"]' "$XUNIT_FILE" | awk '
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

# Add the <properties> section manually (optional)
/usr/bin/xmllint --xpath '//*[local-name()="properties"]' "$XUNIT_FILE" >> "$JUNIT_FILE"

# Loop through each <testcase> in the xUnit XML and write to JUnit format
/usr/bin/xmllint --xpath '//*[local-name()="testcase"]' "$XUNIT_FILE" | awk '
{
    gsub(/<testcase/, "<testcase");
    gsub(/classname=/, "classname=");
    gsub(/name=/, "name=");
    gsub(/time=/, "time=");
    print $0;
}' >> "$JUNIT_FILE"

# Close the JUnit XML structure
echo '</testsuite>' >> "$JUNIT_FILE"
echo '</testsuites>' >> "$JUNIT_FILE"

echo "Conversion complete. JUnit XML saved to: $JUNIT_FILE"
