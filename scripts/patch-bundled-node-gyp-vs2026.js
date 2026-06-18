/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

/**
 * Teach npm's bundled node-gyp about Visual Studio 2026.
 *
 * The Windows runner image (win25-vs2026) ships Visual Studio 2026, whose
 * internal major version is 18. node-gyp 11.x -- bundled with npm 10.x on
 * Node 22 -- has no mapping for version 18, so native module builds (e.g.
 * tree-sitter, via node-gyp-build) fail with:
 *
 *   find VS unknown version "undefined" found at "...\18\Enterprise"
 *   could not find a version of Visual Studio 2017 or newer to use
 *
 * node-gyp-build invokes `node-gyp.cmd` from PATH, which npm populates with
 * its bundled node-gyp; npm_config_node_gyp and a globally-installed node-gyp
 * are NOT consulted on this path. So the only reliable fix without upgrading
 * npm (which validates our npm-10-generated lock file too strictly and breaks
 * `npm ci`) is to patch the bundled node-gyp in place.
 *
 * This replicates the two changes node-gyp 12.1.0 made to add VS 2026 support:
 *   1. map versionMajor 18 -> versionYear 2026 in getVersionInfo()
 *   2. add 2026 to the supported-years arrays ([2019, 2022] -> [2019, 2022, 2026])
 *
 * The script is idempotent and a no-op once the bundled node-gyp is >= 12.1.0,
 * so it can be removed when the runner's bundled npm ships node-gyp with native
 * VS 2026 support. Refs:
 *   https://github.com/nodejs/node-gyp/issues/3282
 *   https://github.com/nodejs/node/issues/60861
 */

const fs = require('fs');
const path = require('path');

// npm's bundled node-gyp lives next to the running node binary.
const nodeDir = path.dirname(process.execPath);
const target = path.join(nodeDir, 'node_modules', 'npm', 'node_modules', 'node-gyp', 'lib', 'find-visualstudio.js');

if (!fs.existsSync(target)) {
	console.error(`[patch-node-gyp] Could not find bundled node-gyp at: ${target}`);
	process.exit(1);
}

const original = fs.readFileSync(target, 'utf8');

if (original.includes('ret.versionMajor === 18')) {
	console.log(`[patch-node-gyp] Bundled node-gyp already supports VS 2026 (v18); nothing to do.`);
	process.exit(0);
}

let patched = original;

// 1) Map VS major version 18 -> year 2026 by inserting a block ahead of the v17 block.
const v17Anchor = 'if (ret.versionMajor === 17) {';
if (!patched.includes(v17Anchor)) {
	console.error('[patch-node-gyp] Anchor for the versionMajor mapping not found; node-gyp layout changed.');
	process.exit(1);
}
const v18Block = [
	'if (ret.versionMajor === 18) {',
	'      ret.versionYear = 2026',
	'      return ret',
	'    }',
	'    ' + v17Anchor
].join('\n');
patched = patched.replace(v17Anchor, v18Block);

// 2) Add 2026 to every supported-years array.
const yearsBefore = '[2019, 2022]';
const yearsAfter = '[2019, 2022, 2026]';
const yearsCount = patched.split(yearsBefore).length - 1;
if (yearsCount === 0) {
	console.error('[patch-node-gyp] Supported-years array [2019, 2022] not found; node-gyp layout changed.');
	process.exit(1);
}
patched = patched.split(yearsBefore).join(yearsAfter);

fs.writeFileSync(target, patched);

// Verify the changes actually landed (guard against silent no-ops).
const verify = fs.readFileSync(target, 'utf8');
const okMapping = verify.includes('ret.versionYear = 2026');
const okYears = (verify.split(yearsAfter).length - 1) === yearsCount;
if (!okMapping || !okYears) {
	console.error(`[patch-node-gyp] Verification failed (mapping=${okMapping}, years=${okYears}).`);
	process.exit(1);
}

console.log(`[patch-node-gyp] Patched ${target}`);
console.log(`[patch-node-gyp]   - mapped VS v18 -> 2026`);
console.log(`[patch-node-gyp]   - added 2026 to ${yearsCount} supported-years array(s)`);
