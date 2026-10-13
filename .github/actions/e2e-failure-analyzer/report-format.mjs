/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Deterministic presentation layer over the model's report. The model writes
// the analysis; this module reads its Summary table (one row per hard failure)
// and adds the parts that must be consistent run to run:
// - the issue breakdown, e.g. "1 product issue (suspected), 2 test issues.",
//   posted to Slack and shown as a callout above the Summary (the callout also
//   adds "2 tests passed on retry."),
// - a colored category icon on each Summary row and Detailed Analysis heading,
//   plus a short Root cause cell and an icon legend under the table.
// Each hard failure is counted under exactly one bucket. Kept separate from
// analyze.mjs, which reads env vars at import time, so the tests can import it.

/**
 * Root-cause categories from the rubric: the text to match in a Root cause
 * cell, the label shown in the table, and the bucket it is counted under.
 * "flaky test" here is a HARD failure the model attributed to a flake,
 * distinct from tests that actually passed on retry.
 */
const CATEGORIES = [
	{ match: 'product regression', label: 'product regression', bucket: 'product' },
	{ match: 'locator drift', label: 'locator drift / stale selector', bucket: 'test' },
	{ match: 'stale selector', label: 'locator drift / stale selector', bucket: 'test' },
	{ match: 'test logic bug', label: 'test logic bug', bucket: 'test' },
	{ match: 'test environment issue', label: 'test environment issue', bucket: 'test' },
	{ match: 'flaky test', label: 'flaky test', bucket: 'flaky' },
	{ match: 'infrastructure issue', label: 'infrastructure issue', bucket: 'infra' },
	{ match: 'timeout', label: 'timeout', bucket: 'other' },
];

/**
 * Buckets in display order. Icons are GitHub emoji shortcodes so the source
 * stays ASCII; they render in step summaries.
 */
const BUCKETS = [
	{ id: 'product', singular: 'product issue', plural: 'product issues', icon: ':red_circle:', legend: 'product' },
	{ id: 'test', singular: 'test issue', plural: 'test issues', icon: ':yellow_circle:', legend: 'test' },
	{ id: 'flaky', singular: 'flaky failure', plural: 'flaky failures', icon: ':orange_circle:', legend: 'flaky' },
	{ id: 'infra', singular: 'infra issue', plural: 'infra issues', icon: ':large_blue_circle:', legend: 'infra' },
	{ id: 'other', singular: 'unclassified', plural: 'unclassified', icon: ':white_circle:', legend: 'unclassified' },
];
const BUCKET_BY_ID = new Map(BUCKETS.map(b => [b.id, b]));

/**
 * Split a markdown table row into trimmed cells, honoring escaped pipes.
 * @param {string} line
 * @returns {string[]}
 */
function splitRow(line) {
	return line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map(c => c.trim());
}

/**
 * Locate the `## Summary` table.
 * @param {string[]} lines The report, split into lines.
 * @returns {{ start: number, end: number, rows: { test: string, platform: string, cause: string }[] } | undefined}
 * `start`/`end` are the table's first and last line indices. Undefined when
 * there is no Summary heading, no table, or no Root cause column.
 */
function findSummaryTable(lines) {
	const heading = lines.findIndex(l => /^##\s+Summary\b/.test(l));
	if (heading < 0) { return undefined; }

	let start = -1;
	let end = -1;
	let columns;
	const rows = [];
	for (let i = heading + 1; i < lines.length; i++) {
		const line = lines[i];
		if (/^##\s/.test(line)) { break; }
		if (!line.trim().startsWith('|')) {
			if (start >= 0) { break; }
			continue;
		}
		const cells = splitRow(line);
		if (start < 0) {
			start = i;
			const find = re => cells.findIndex(c => re.test(c));
			columns = { test: find(/^test$/i), platform: find(/platform/i), cause: find(/root cause/i) };
			if (columns.cause < 0) { return undefined; }
		} else if (!cells.every(c => /^:?-+:?$/.test(c))) {
			rows.push({
				test: cells[columns.test] ?? '',
				platform: cells[columns.platform] ?? '',
				cause: cells[columns.cause] ?? '',
			});
		}
		end = i;
	}
	return start < 0 ? undefined : { start, end, rows };
}

/**
 * Extract the Root cause cell of every row in the report's `## Summary` table.
 * @param {string} report The model's markdown report.
 * @returns {string[]} One root-cause string per hard failure row.
 */
export function parseSummaryRootCauses(report) {
	const table = findSummaryTable(String(report || '').split(/\r?\n/));
	return table ? table.rows.map(r => r.cause) : [];
}

/**
 * Classify a root-cause cell. The cell usually leads with the rubric category
 * and adds a parenthetical ("test logic bug (under-budgeted wait)"), so the
 * earliest category name in the cell wins; a later mention inside the
 * parenthetical does not override it.
 * @param {string} cause
 * @returns {{ bucket: string, suspected: boolean, label: string }} `label` is
 * the bare category ("suspected product regression"), or the original cell
 * when no category matched.
 */
export function classifyRootCause(cause) {
	const text = cause.toLowerCase();
	let best;
	for (const category of CATEGORIES) {
		const index = text.indexOf(category.match);
		if (index >= 0 && (!best || index < best.index)) {
			best = { index, category };
		}
	}
	if (!best) {
		return { bucket: 'other', suspected: false, label: cause };
	}
	const suspected = best.category.bucket === 'product' && /suspected/.test(text);
	return {
		bucket: best.category.bucket,
		suspected,
		label: `${suspected ? 'suspected ' : ''}${best.category.label}`,
	};
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
 * Count hard failures per bucket.
 * @param {string[]} rootCauses
 * @returns {{ bucket: string, text: string }[]} One entry per non-empty bucket,
 * in display order, e.g. { bucket: 'product', text: '2 product issues (1 suspected)' }.
 */
function bucketCounts(rootCauses) {
	const counts = new Map();
	let suspected = 0;
	for (const cause of rootCauses) {
		const c = classifyRootCause(cause);
		counts.set(c.bucket, (counts.get(c.bucket) || 0) + 1);
		if (c.suspected) { suspected++; }
	}
	return BUCKETS.filter(b => counts.get(b.id)).map(b => {
		const n = counts.get(b.id);
		let text = count(n, b.singular, b.plural);
		if (b.id === 'product' && suspected) {
			text += suspected === n ? ' (suspected)' : ` (${suspected} suspected)`;
		}
		return { bucket: b.id, text };
	});
}

/**
 * @param {number} flakyCount
 * @returns {string} The "N tests passed on retry." sentence, or ''.
 */
function retrySentence(flakyCount) {
	return flakyCount > 0 ? ` ${count(flakyCount, 'test', 'tests')} passed on retry.` : '';
}

/**
 * Render the Slack breakdown. Hard failures only: tests that passed on retry
 * did not break the run, so they are left out of the Slack post (the report's
 * callout still mentions them).
 * @param {string[]} rootCauses One entry per hard failure (from parseSummaryRootCauses).
 * @returns {string} The breakdown, or '' when there are no rows to count (the
 * report had no parseable Summary table), so the caller can fall back.
 */
export function renderSlackSummary(rootCauses) {
	if (!rootCauses.length) { return ''; }
	return `${bucketCounts(rootCauses).map(p => p.text).join(', ')}.`;
}

/**
 * Render the breakdown as a GitHub alert: CAUTION (red) with the product part
 * in bold when there is a product issue, NOTE otherwise.
 * @param {string[]} rootCauses
 * @param {number} flakyCount
 * @returns {string[]} Markdown lines, or [] when there are no rows.
 */
function renderCallout(rootCauses, flakyCount) {
	if (!rootCauses.length) { return []; }
	const parts = bucketCounts(rootCauses);
	const hasProduct = parts.some(p => p.bucket === 'product');
	const text = parts.map(p => p.bucket === 'product' ? `**${p.text}**` : p.text).join(', ');
	return [hasProduct ? '> [!CAUTION]' : '> [!NOTE]', `> ${text}.${retrySentence(flakyCount)}`];
}

/**
 * Apply the deterministic presentation to the model's report.
 * @param {string} report The model's report, starting at `## Summary`.
 * @param {{ flakyCount: number, note: string }} options `note` is inline
 * markdown shown in small text under the Summary table (the run stats).
 * @returns {{ report: string, slack: string }} The decorated report, and the
 * Slack breakdown ('' when the Summary table could not be parsed).
 */
export function decorateReport(report, { flakyCount, note }) {
	const lines = String(report).split(/\r?\n/);
	const table = findSummaryTable(lines);
	if (!table || !table.rows.length) {
		// Leave the model's text alone; just append the note.
		return { report: `${lines.join('\n').trimEnd()}\n\n<sub>${note}</sub>\n`, slack: '' };
	}

	const rows = table.rows.map(r => ({ ...r, ...classifyRootCause(r.cause) }));
	const causes = rows.map(r => r.cause);
	const present = BUCKETS.filter(b => rows.some(r => r.bucket === b.id));
	const legend = present.map(b => `${b.icon} ${b.legend}`).join(' &middot; ');

	// Rebuild the table: icon column, short Root cause, no Severity column (every
	// row is a hard failure). Test and Platform cells are kept verbatim.
	const tableLines = [
		'| | Test | Platform | Root cause |',
		'|---|------|----------|------------|',
		...rows.map(r => `| ${BUCKET_BY_ID.get(r.bucket).icon} | ${r.test} | ${r.platform} | ${r.label} |`),
		'',
		`<sub>${legend} &nbsp;|&nbsp; ${note}</sub>`,
	];

	// Prefix each Detailed Analysis heading with its row's icon. A heading
	// names one test (possibly covering several platforms); match it by name.
	const detailStart = lines.findIndex((l, i) => i > table.end && /^##\s+Detailed Analysis\b/.test(l));
	if (detailStart >= 0) {
		for (let i = detailStart + 1; i < lines.length && !/^##\s/.test(lines[i]); i++) {
			const m = /^###\s+(?<title>.*)$/.exec(lines[i]);
			if (!m || m.groups.title.startsWith(':')) { continue; }
			const row = rows.find(r => r.test && m.groups.title.includes(r.test.replace(/\\\|/g, '|')));
			if (row) {
				lines[i] = `### ${BUCKET_BY_ID.get(row.bucket).icon} ${m.groups.title}`;
			}
		}
	}

	lines.splice(table.start, table.end - table.start + 1, ...tableLines);
	const summaryHeading = lines.findIndex(l => /^##\s+Summary\b/.test(l));
	lines.splice(summaryHeading, 0, ...renderCallout(causes, flakyCount), '');

	return { report: lines.join('\n'), slack: renderSlackSummary(causes) };
}
