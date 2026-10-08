/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Builds the one-line breakdown that goes into the Slack thread, e.g.
// "1 product issue (suspected), 2 test issues. 2 tests passed on retry."
// Each hard failure is counted under exactly one bucket. The counts come from the report's Summary table (one row per hard failure)
// and the analyzer's own flaky count, not from model-written prose, so the
// numbers always match the report. Kept separate from analyze.mjs, which
// reads env vars at import time, so the tests can import it.

/**
 * Root-cause categories from the rubric, mapped to the bucket they are counted
 * under. "flaky test" here is a HARD failure the model attributed to a flake,
 * distinct from tests that actually passed on retry.
 */
const CATEGORY_BUCKETS = [
	['product regression', 'product'],
	['locator drift', 'test'],
	['stale selector', 'test'],
	['test logic bug', 'test'],
	['test environment issue', 'test'],
	['flaky test', 'flaky'],
	['infrastructure issue', 'infra'],
	['timeout', 'other'],
];

/** Display order and labels for the buckets. */
const BUCKET_LABELS = [
	['product', 'product issue', 'product issues'],
	['test', 'test issue', 'test issues'],
	['flaky', 'flaky failure', 'flaky failures'],
	['infra', 'infra issue', 'infra issues'],
	['other', 'unclassified', 'unclassified'],
];

/**
 * Split a markdown table row into trimmed cells, honoring escaped pipes.
 * @param {string} line
 * @returns {string[]}
 */
function splitRow(line) {
	return line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map(c => c.trim());
}

/**
 * Extract the Root cause cell of every row in the report's `## Summary` table.
 * @param {string} report The model's markdown report.
 * @returns {string[]} One root-cause string per hard failure row.
 */
export function parseSummaryRootCauses(report) {
	const lines = String(report || '').split(/\r?\n/);
	const start = lines.findIndex(l => /^##\s+Summary\b/.test(l));
	if (start < 0) { return []; }

	const causes = [];
	let causeColumn = -1;
	for (const line of lines.slice(start + 1)) {
		if (/^##\s/.test(line)) { break; }
		if (!line.trim().startsWith('|')) {
			if (causeColumn >= 0 && line.trim()) { break; }
			continue;
		}
		const cells = splitRow(line);
		if (causeColumn < 0) {
			causeColumn = cells.findIndex(c => /root cause/i.test(c));
			if (causeColumn < 0) { return []; }
			continue;
		}
		if (cells.every(c => /^:?-+:?$/.test(c))) { continue; }
		causes.push(cells[causeColumn] || '');
	}
	return causes;
}

/**
 * Map a root-cause cell to a bucket. The cell usually leads with the rubric
 * category and adds a parenthetical ("test logic bug (under-budgeted wait)"),
 * so the earliest category name in the cell wins; a later mention inside the
 * parenthetical does not override it.
 * @param {string} cause
 * @returns {{ bucket: string, suspected: boolean }}
 */
export function bucketRootCause(cause) {
	const text = cause.toLowerCase();
	let best = { index: Infinity, bucket: 'other' };
	for (const [name, bucket] of CATEGORY_BUCKETS) {
		const index = text.indexOf(name);
		if (index >= 0 && index < best.index) {
			best = { index, bucket };
		}
	}
	return { bucket: best.bucket, suspected: best.bucket === 'product' && /suspected/.test(text) };
}

/**
 * @param {number} n
 * @param {string} singular
 * @param {string} plural
 */
function count(n, singular, plural) {
	return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * Render the Slack breakdown sentence(s).
 * @param {string[]} rootCauses One entry per hard failure (from parseSummaryRootCauses).
 * @param {number} flakyCount Tests that failed and then passed on retry.
 * @returns {string} The breakdown, or '' when there are no rows to count (the
 * report had no parseable Summary table), so the caller can fall back.
 */
export function renderSlackSummary(rootCauses, flakyCount) {
	if (!rootCauses.length) { return ''; }

	const counts = new Map();
	let suspected = 0;
	for (const cause of rootCauses) {
		const { bucket, suspected: isSuspected } = bucketRootCause(cause);
		counts.set(bucket, (counts.get(bucket) || 0) + 1);
		if (isSuspected) { suspected++; }
	}

	const parts = BUCKET_LABELS
		.filter(([bucket]) => counts.get(bucket))
		.map(([bucket, singular, plural]) => {
			const n = counts.get(bucket);
			let part = count(n, singular, plural);
			if (bucket === 'product' && suspected) {
				part += suspected === n ? ' (suspected)' : ` (${suspected} suspected)`;
			}
			return part;
		});
	const sentences = [`${parts.join(', ')}.`];
	if (flakyCount > 0) {
		sentences.push(`${count(flakyCount, 'test', 'tests')} passed on retry.`);
	}
	return sentences.join(' ');
}
