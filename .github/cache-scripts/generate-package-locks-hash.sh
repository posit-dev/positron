#!/usr/bin/env bash
# ============================================================================
# generate-package-locks-hash.sh - Cache Key Generator for Core Dependencies
# ============================================================================
#
# WHAT THIS DOES:
# Creates a deterministic hash used as the cache key for npm-core cache.
# The hash includes:
# 1. All core package-lock.json files (dependency versions)
# 2. Build scripts that affect postinstall behavior (what gets generated)
#
# When any of these change, the hash changes and cache invalidates.
#
# WHY INCLUDE BUILD SCRIPTS?
# The postinstall script runs during `npm install` and generates artifacts
# beyond just node_modules (e.g., ESM dependencies, compiled assets). When
# the cache is restored, npm skips postinstall because deps appear installed,
# but new/changed build steps won't run. Including these scripts in the hash
# ensures cache invalidation when postinstall behavior changes.
#
# See: https://github.com/posit-dev/positron/pull/11873 for context on why
# this was needed (ESM build step added to postinstall required manual bump).
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
# Directory list: build/npm/dirs.ts (dirs array)
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
# SECTION 1: Generate Hash from dirs.ts and build scripts
# ============================================================================
# Use Node.js to read dirs.ts and hash all core package-lock.json files
# plus critical build scripts that affect postinstall behavior.
# Why Node.js? dirs.ts is a TS module, easier to read with require().

echo "Generating package-locks hash for npm-core cache..."

HASH=$(node -e "
const { dirs } = require('./build/npm/dirs.ts');
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

console.error('Core directories from dirs.ts: ' + coreDirs.length);

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
// Step 3: Collect build scripts that affect postinstall behavior
// ----------------------------------------------------------------------------
// These scripts control what runs during npm install and what artifacts are
// generated. Changes to these should invalidate the cache even if package-lock
// files haven't changed.
//
// NOTE: If you add a new script that runs during postinstall, add it here!
const buildScripts = [
  'build/npm/postinstall.ts',  // Main postinstall script
  'build/npm/dirs.ts',         // Controls which directories get npm install
].sort();

console.error('');
console.error('Hashing ' + buildScripts.length + ' build scripts:');
buildScripts.forEach(f => console.error('  → ' + f));

// ----------------------------------------------------------------------------
// Step 4: Hash all files together
// ----------------------------------------------------------------------------
// Read each file and update the running hash. Sort order ensures deterministic hash.
const hash = crypto.createHash('sha256');
for (const file of [...lockFiles, ...buildScripts]) {
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
