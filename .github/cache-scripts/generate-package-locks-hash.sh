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
# 3. Gitlink SHAs of submodules that host a core dir (e.g. ai-lib). Their build
#    output is cached (see cache-paths.sh) and regenerated only on a submodule
#    bump, which moves the gitlink SHA. Deps-only signals would miss source-only
#    bumps and restore a stale build.
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
// NOTE: If you add a new script that runs during install, add it here!
const buildScripts = [
  'build/npm/preinstall.ts',   // Preinstall script - installs build/ dependencies
  'build/npm/postinstall.ts',  // Postinstall script - runs npm install in all dirs
  'build/npm/dirs.ts',         // List of directories that get npm install
  // Defines which paths this cache saves. Changing the set (e.g. adding a
  // node_modules dir) must rotate the key: on a plain key hit actions/cache
  // restores the old blob and never re-saves, so a newly-added path would stay
  // missing until the key changes. Folding this file in rebuilds the cache the
  // first time the path set changes.
  '.github/cache-scripts/cache-paths.sh',
].sort();

console.error('');
console.error('Hashing ' + buildScripts.length + ' build scripts:');
buildScripts.forEach(f => console.error('  → ' + f));

// ----------------------------------------------------------------------------
// Step 3.5: Collect submodule gitlink SHAs for core dirs hosted in a submodule
// ----------------------------------------------------------------------------
// A core dir such as 'ai-lib/packages/ai-config' lives inside the ai-lib
// submodule. Its build output is cached (cache-paths.sh) but is regenerated
// only when the submodule is bumped, which moves the gitlink SHA the parent
// repo records for that submodule. Folding that SHA into the key busts the
// cache on every bump, so a stale build is never restored. A package-lock.json
// signal alone would miss source-only bumps (and ai-lib's lockfile isn't even
// at the core-dir path -- it's the workspace root's).
// spawnSync with an argument array (never a shell string) so submodule paths
// parsed from .gitmodules can't be interpreted as shell syntax.
const { spawnSync } = require('child_process');
const git = (args) => {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error('git ' + args.join(' ') + ' failed: ' + (r.stderr || '').trim());
  }
  return r.stdout;
};

let submodulePaths = [];
try {
  const out = git(['config', '--file', '.gitmodules', '--get-regexp', 'path']);
  submodulePaths = out.split('\n').map(l => l.trim().split(/\s+/)[1]).filter(Boolean);
} catch {
  // No .gitmodules (or no submodules) -- nothing to fold in.
}

const submoduleRoots = new Set();
for (const dir of coreDirs) {
  for (const sub of submodulePaths) {
    if (dir === sub || dir.startsWith(sub + '/')) {
      submoduleRoots.add(sub);
    }
  }
}

const submoduleGitlinks = [...submoduleRoots].sort().map(sub => ({
  sub,
  // Read the gitlink from the tree, so this works even when the submodule
  // isn't checked out. Throws loudly if a declared submodule can't resolve.
  sha: git(['rev-parse', 'HEAD:' + sub]).trim(),
}));

console.error('');
console.error('Hashing ' + submoduleGitlinks.length + ' submodule gitlink(s):');
submoduleGitlinks.forEach(({ sub, sha }) => console.error('  → ' + sub + ' @ ' + sha));

// ----------------------------------------------------------------------------
// Step 4: Hash all files together
// ----------------------------------------------------------------------------
// Read each file and update the running hash. Sort order ensures deterministic hash.
const hash = crypto.createHash('sha256');
for (const file of [...lockFiles, ...buildScripts]) {
  hash.update(fs.readFileSync(file));
}
for (const { sub, sha } of submoduleGitlinks) {
  hash.update(sub + ':' + sha);
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
