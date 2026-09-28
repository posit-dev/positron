/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Shard jobs swallow Playwright's exit code so the merged report decides
// pass/fail. This reads that report and exits non-zero if any spec failed.

const fs = require('fs');
const path = require('path');

if (process.argv.length < 3) {
	console.error('Usage: node check-e2e-failures.js <path-to-playwright-json>');
	process.exit(2);
}

const filePath = path.resolve(process.argv[2]);

const FAIL_STATUSES = new Set(['failed', 'timedOut', 'interrupted']);

function specFailed(spec) {
	if (typeof spec.ok === 'boolean') { return !spec.ok; }

	const tests = Array.isArray(spec.tests) ? spec.tests : [];
	const anyAttemptPassed = tests.some(t =>
		Array.isArray(t.results) && t.results.some(r => r?.status === 'passed')
	);
	if (anyAttemptPassed) { return false; }

	return tests.some(t =>
		Array.isArray(t.results) && t.results.some(r => FAIL_STATUSES.has(r?.status))
	);
}

function collectAllSpecs(root) {
	const specs = [];

	function walkSuite(suite, suitePath = []) {
		if (!suite || typeof suite !== 'object') { return; }

		if (Array.isArray(suite.suites)) {
			for (const child of suite.suites) {
				walkSuite(child, suitePath.concat(suite.title || suite.name || ''));
			}
		}

		if (Array.isArray(suite.specs)) {
			for (const spec of suite.specs) {
				specs.push({
					...spec,
					__file: spec.file || suite.file || suite.location?.file || root?.config?.rootDir,
					__suitePath: suitePath.filter(Boolean),
				});
			}
		}

		if (Array.isArray(suite.tests)) {
			specs.push({
				...suite,
				__file: suite.file || suite.location?.file || root?.config?.rootDir,
				__suitePath: suitePath.filter(Boolean),
			});
		}
	}

	if (Array.isArray(root?.suites)) {
		for (const top of root.suites) { walkSuite(top, [top.title || top.name || '']); }
	} else {
		walkSuite(root, []);
	}

	return specs;
}

function loadJson(fp) {
	try {
		return JSON.parse(fs.readFileSync(fp, 'utf8'));
	} catch (err) {
		console.error(`Failed to read/parse JSON: ${fp}`);
		console.error(err?.message || err);
		process.exit(2);
	}
}

const failedSpecs = collectAllSpecs(loadJson(filePath)).filter(specFailed);

if (failedSpecs.length === 0) {
	console.log('passed');
	process.exit(0);
}

console.log('failed');
for (const spec of failedSpecs) {
	const file = spec.__file || spec.file || '<unknown file>';
	const title = spec.title || '<untitled spec>';
	const where = spec.__suitePath?.length ? ` [${spec.__suitePath.join(' / ')}]` : '';
	// allow-any-unicode-next-line
	console.error(`  ❌ ${title}${where}  (${file})`);
}
process.exit(1);
