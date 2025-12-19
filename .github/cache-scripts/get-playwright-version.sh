#!/usr/bin/env bash
set -euo pipefail

# get-playwright-version.sh
#
# Extracts the @playwright/test version from package.json for cache key generation
#
# Usage:
#   ./get-playwright-version.sh
#
# Outputs:
#   Sets GITHUB_OUTPUT variable 'version' with the Playwright version

# Get Playwright version from package.json
PW_VERSION=$(node -e "
const pkg = require('./package.json');
const version = pkg.devDependencies['@playwright/test'] || pkg.dependencies['@playwright/test'];
if (!version) {
  console.error('@playwright/test not found in package.json');
  process.exit(1);
}
// Remove ^ or ~ prefix if present
const cleanVersion = version.replace(/^[\^~]/, '');
console.log(cleanVersion);
")

echo "Playwright version: $PW_VERSION"

# Output to GitHub Actions if running in CI
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "version=$PW_VERSION" >> "$GITHUB_OUTPUT"
fi
