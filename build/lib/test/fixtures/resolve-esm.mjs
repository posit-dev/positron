/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Resolves ESM specifiers as an import from `parentURL` would, and prints one
// JSON record per specifier. positron-path-budget.test.ts runs this file in a
// child process.
//
// Usage: node --experimental-import-meta-resolve resolve-esm.mjs <parentURL> <specs-json>
//
// Node has no stable in-process API that resolves an ESM specifier from an
// arbitrary parent. `import.meta.resolve` takes a parent only with the flag
// above, and it ignores the parent without the flag. So this script first
// checks that the parent is honored, and exits non-zero if it is not.

const [parentURL, specsJson] = process.argv.slice(2);

const probe = import.meta.resolve('./probe.js', parentURL);
if (probe !== new URL('./probe.js', parentURL).href) {
	console.error(`import.meta.resolve ignored the parent URL (got ${probe}); run with --experimental-import-meta-resolve`);
	process.exit(1);
}

const out = [];
for (const spec of JSON.parse(specsJson)) {
	try {
		out.push({ spec, mode: 'esm', resolved: import.meta.resolve(spec, parentURL) });
	} catch (e) {
		out.push({ spec, mode: 'esm', errorCode: e?.code });
	}
}
console.log(JSON.stringify(out));
