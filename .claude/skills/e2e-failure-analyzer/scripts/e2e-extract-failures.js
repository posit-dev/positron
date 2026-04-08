#!/usr/bin/env node
// Extracts failed tests from a merged Playwright JSON report.
// Usage: node e2e-extract-failures.js <report.json>
// Output: JSON array of failures with title, file, tags, suite, project, errors

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const reportPath = process.argv[2];
if (!reportPath) {
	console.error('Usage: node e2e-extract-failures.js <report.json>');
	process.exit(1);
}

const resolved = resolve(reportPath);
if (!existsSync(resolved)) {
	console.error(`File not found: ${resolved}`);
	process.exit(1);
}

const report = JSON.parse(readFileSync(resolved, 'utf8'));
const FAIL_STATUSES = new Set(['failed', 'timedOut', 'interrupted']);

function walk(suite, suitePath) {
	const results = [];
	for (const child of suite.suites || []) {
		results.push(...walk(child, suitePath.concat(child.title || '')));
	}
	for (const spec of suite.specs || []) {
		const failed = typeof spec.ok === 'boolean'
			? !spec.ok
			: spec.tests?.some(t => t.results?.some(r => FAIL_STATUSES.has(r?.status))) &&
			  !spec.tests?.some(t => t.results?.some(r => r?.status === 'passed'));
		if (!failed) continue;

		const errors = [];
		const projects = new Set();
		for (const t of spec.tests || []) {
			if (t.projectName) projects.add(t.projectName);
			for (const r of t.results || []) {
				if (FAIL_STATUSES.has(r?.status)) {
					errors.push({
						status: r.status,
						error: (r.error?.message || '').slice(0, 2000),
						snippet: (r.error?.snippet || '').slice(0, 1000),
					});
				}
			}
		}

		results.push({
			title: spec.title,
			file: spec.file || spec.location?.file,
			tags: spec.tags || [],
			suite: suitePath.filter(Boolean).join(' > '),
			project: [...projects].join(', ') || 'unknown',
			errors,
		});
	}
	return results;
}

const failures = [];
for (const s of report.suites || []) {
	failures.push(...walk(s, [s.title || '']));
}

console.log(JSON.stringify(failures, null, 2));

if (failures.length === 0) {
	process.stderr.write('No failures found in report.\n');
}
