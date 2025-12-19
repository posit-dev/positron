#!/usr/bin/env bash
# ============================================================================
# generate-package-locks-hash.sh - Cache Key Generator for Core Dependencies
# ============================================================================
#
# WHAT THIS DOES:
# Creates a deterministic hash used as the cache key for npm-core cache.
# When any core package-lock.json changes, the hash changes and cache invalidates.
#
# WHAT IS "CORE"?
# Core = Non-extension directories that need npm install:
# • Root directory (./package-lock.json)
# • build/
# • remote/
# • test/integration/browser/
# • test/monaco/
# • test/mcp/
#
# Basically: Everything except extensions/ and .vscode/
#
# WHY NOT EXTENSIONS?
# Extensions have their own caches (npm-extensions-volatile and npm-extensions-stable)
# that invalidate separately. This allows core dependencies to cache independently
# from extension dependencies.
#
# SINGLE SOURCE OF TRUTH:
# Directory list: build/npm/dirs.js (dirs array)
# This script reads from that file - never hardcode directory list here!
#
# USAGE:
# ./generate-package-locks-hash.sh
#
# OUTPUT:
# Writes "hash=<sha256>" to $GITHUB_OUTPUT for use in cache keys
#
# ============================================================================

set -euo pipefail

# ============================================================================
# SECTION 1: Generate Hash from dirs.js
# ============================================================================
# Use Node.js to read dirs.js and hash all core package-lock.json files.
# Why Node.js? dirs.js is a JS module, easier to read with require().

echo "Generating package-locks hash for npm-core cache..."

HASH=$(node -e "
const { dirs } = require('./build/npm/dirs.js');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// ----------------------------------------------------------------------------
// Step 1: Filter to core directories (exclude extensions and .vscode)
// ----------------------------------------------------------------------------
const coreDirs = dirs.filter(d =>
  !d.startsWith('extensions/') &&
  !d.startsWith('.vscode/')
);

console.error('Core directories from dirs.js: ' + coreDirs.length);

// ----------------------------------------------------------------------------
// Step 2: Map to package-lock.json paths
// ----------------------------------------------------------------------------
// Root dir ('') maps to './package-lock.json'
// Other dirs map to '{dir}/package-lock.json'
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

console.error('');
console.error('Hashing ' + lockFiles.length + ' package-lock.json files:');
lockFiles.forEach(f => console.error('  → ' + f));

// ----------------------------------------------------------------------------
// Step 3: Hash all files together
// ----------------------------------------------------------------------------
// Read each file and update the running hash
// Sort order ensures deterministic hash
const hash = crypto.createHash('sha256');
for (const file of lockFiles) {
  hash.update(fs.readFileSync(file));
}

const finalHash = hash.digest('hex');
console.error('');
console.log(finalHash);
")

# ============================================================================
# SECTION 2: Validate & Output
# ============================================================================

# Validate hash is not empty
if [ -z "$HASH" ]; then
	echo "❌ Hash generation failed. Cache will be disabled for this run."
	exit 1
fi

# Output to GITHUB_OUTPUT (if in CI) or stdout (if local)
if [ -n "${GITHUB_OUTPUT:-}" ]; then
	echo "hash=$HASH" >> "$GITHUB_OUTPUT"
fi

echo "✓ Generated package-locks hash: $HASH"
