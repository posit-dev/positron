#!/usr/bin/env bash
# Generate package-locks hash for npm-core cache key from dirs.js
#
# PURPOSE:
# The npm-core cache invalidates when any "core" package-lock.json file changes.
# Core = non-extension directories: root, build/, remote/, test/{integration,monaco,mcp}
#
# SINGLE SOURCE OF TRUTH:
# This script reads build/npm/dirs.js directly to discover which directories have
# package-lock.json files. When new directories are added to dirs.js, this script
# automatically includes them in the hash - no manual updates needed!
#
# HOW IT WORKS:
# 1. Read dirs.js to get list of directories that get npm install during postinstall
# 2. Filter to "core" dirs (exclude extensions/ and .vscode/)
# 3. Map to package-lock.json paths (e.g., "build" -> "build/package-lock.json")
# 4. Read and hash all package-lock.json files
# 5. Output combined hash for use as cache key
#
# OUTPUT:
# Writes "hash=<sha256>" to $GITHUB_OUTPUT for use as npm-core cache key

set -euo pipefail

# Generate hash from dirs.js
HASH=$(node -e "
const { dirs } = require('./build/npm/dirs.js');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// Filter to core dirs (exclude extensions and .vscode)
const coreDirs = dirs.filter(d =>
  !d.startsWith('extensions/') &&
  !d.startsWith('.vscode/')
);

// Map to package-lock.json paths
const lockFiles = coreDirs
  .map(d => d === '' ? 'package-lock.json' : path.join(d, 'package-lock.json'))
  .filter(f => {
    try {
      return fs.existsSync(f);
    } catch {
      return false;
    }
  })
  .sort();

console.error('Hashing package-lock.json files from dirs.js:');
lockFiles.forEach(f => console.error('  - ' + f));

// Hash all files together
const hash = crypto.createHash('sha256');
for (const file of lockFiles) {
  hash.update(fs.readFileSync(file));
}
console.log(hash.digest('hex'));
")

# Validate hash is not empty
if [ -z "$HASH" ]; then
	echo "::warning::package-locks hash generation failed. Cache will be disabled for this run."
	exit 1
fi

# Output to GITHUB_OUTPUT (if running in CI) or stdout (if running locally)
if [ -n "${GITHUB_OUTPUT:-}" ]; then
	echo "hash=$HASH" >> "$GITHUB_OUTPUT"
fi
echo "Generated package-locks hash: $HASH"
