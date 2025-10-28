/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require('fs');
const path = require('path');

if (process.argv.length < 3) {
	console.error('Usage: node check-soft-fail-failures.js <path-to-playwright-json>');
	process.exit(2);
}

const filePath = path.resolve(process.argv[2]);

/**
 * A spec "fails" if it truly ended up failing after retries.
 * Heuristics:
 * - Prefer `spec.ok` when present (Playwright sets this on specs).
 * - Otherwise, if ANY test result is "passed" (e.g., on retry), treat as passed.
 * - Otherwise, if there exists a result with status in FAIL_STATUSES, treat as failed.
 */
const FAIL_STATUSES = new Set(['failed', 'timedOut', 'interrupted']); // conservative failure set

function specFailed(spec) {

	if (typeof spec.ok === 'boolean') { return !spec.ok; }

	// Fall back to results inspection
	const tests = Array.isArray(spec.tests) ? spec.tests : [];
	// If any attempt passed, this spec should be treated as passed
	const anyAttemptPassed = tests.some(t =>
		Array.isArray(t.results) && t.results.some(r => r?.status === 'passed')
	);

	if (anyAttemptPassed) { return false; }

	// Otherwise, count as failed if we see any failure-ish status
	const anyAttemptFailed = tests.some(t =>
		Array.isArray(t.results) && t.results.some(r => FAIL_STATUSES.has(r?.status))
	);
	return anyAttemptFailed;
}

/**
 * Get tags at the spec level (Playwright JSON reporter puts tags on the spec).
 */
function getSpecTags(spec) {
	return Array.isArray(spec.tags) ? spec.tags : [];
}

/**
 * Traverse the JSON report and collect all specs (objects with a "tests" array).
 * Plays nice with deeply nested suite structures.
 */
function collectAllSpecs(root) {
	const specs = [];

	function walkSuite(suite, suitePath = []) {
		if (!suite || typeof suite !== 'object') { return; }

		// Playwright JSON typically: { suites: [ ... ] }
		if (Array.isArray(suite.suites)) {
			for (const child of suite.suites) {
				walkSuite(child, suitePath.concat(suite.title || suite.name || ''));
			}
		}

		// Newer JSON has "specs" under a suite. Older may inline differently.
		if (Array.isArray(suite.specs)) {
			for (const spec of suite.specs) {
				// Attach some helpful context for reporting
				specs.push({
					...spec,
					__file: spec.file || suite.file || suite.location?.file || root?.config?.rootDir,
					__suitePath: suitePath.filter(Boolean),
				});
			}
		}

		// In some shapes, a suite-like node might itself look like a spec (have tests)
		if (Array.isArray(suite.tests)) {
			specs.push({
				...suite,
				__file: suite.file || suite.location?.file || root?.config?.rootDir,
				__suitePath: suitePath.filter(Boolean),
			});
		}
	}

	// Start walking from all top-level suites
	if (Array.isArray(root?.suites)) {
		for (const top of root.suites) { walkSuite(top, [top.title || top.name || '']); }
	} else {
		// Fallback: try walking the root itself (handles unusual shapes)
		walkSuite(root, []);
	}

	return specs;
}

function loadJson(fp) {
	try {
		const txt = fs.readFileSync(fp, 'utf8');
		return JSON.parse(txt);
	} catch (err) {
		console.error(`Failed to read/parse JSON: ${fp}`);
		console.error(err?.message || err);
		process.exit(2);
	}
}

const report = loadJson(filePath);
const allSpecs = collectAllSpecs(report);

// Determine which specs truly failed
const failedSpecs = allSpecs.filter(spec => specFailed(spec));

// If no failures at all, we're done: passed
if (failedSpecs.length === 0) {
	console.log('passed');
	process.exit(0);
}

// For failures, check :soft-fail tag
const nonSoftFailFailures = failedSpecs.filter(spec => {
	const tags = getSpecTags(spec);
	return !tags.includes(':soft-fail');
});

// If there are any failures that are NOT soft fail → failed
if (nonSoftFailFailures.length > 0) {
	console.log('failed');
	// Helpful summary for triage
	for (const spec of nonSoftFailFailures) {
		const file = spec.__file || spec.file || '<unknown file>';
		const title = spec.title || '<untitled spec>';
		const tags = getSpecTags(spec);
		const where = spec.__suitePath?.length ? ` [${spec.__suitePath.join(' / ')}]` : '';
		// allow-any-unicode-next-line
		console.error(`  ❌ ${title}${where}  (${file})  tags: ${tags.join(', ') || '(none)'}`);
	}
	process.exit(1);
}

// Otherwise, all failures are soft fail → passed
console.log('passed');
process.exit(0);
