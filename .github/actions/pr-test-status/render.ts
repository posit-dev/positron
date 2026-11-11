/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Job, Lane } from './lanes.ts';
import type { CacheEntry, FailedTest, Results } from './results.ts';

/** The content of a check run: status, conclusion, and its page. */
export type CheckOutput = {
	status: 'in_progress' | 'completed';
	conclusion?: 'success' | 'failure' | 'cancelled' | 'neutral' | 'timed_out';
	title: string;
	summary: string;
};

// GitHub caps a check summary at 65535 characters.
const MAX_SUMMARY = 60000;
const SEP = ' \u{B7} ';

const noun = (n: number, one: string, many: string): string => n === 1 ? one : many;
const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const byFile = (a: FailedTest, b: FailedTest): number => a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
const runLink = (runUrl: string): string => `[Full run and artifacts](${runUrl})`;

function failedJobs(lane: Lane): Job[] {
	return lane.jobs.filter(j => j.conclusion === 'failure' || j.conclusion === 'timed_out');
}

/** Log links for a test: its shard's job if known, else every failed job of the lane. */
function logLinks(lane: Lane, shard: number | null): string {
	const own = shard === null ? undefined : lane.jobs.find(j => j.name.endsWith(`-${shard}`));
	const jobs = own ? [own] : failedJobs(lane);
	return jobs.map(j => `[log](${j.html_url})`).join(' ');
}

/** Same layout as Vitest's built-in github-actions reporter. */
function vitestStats(r: Results): string {
	const files: string[] = [];
	const tests: string[] = [];
	const other: string[] = [];
	if (r.files) {
		if (r.files.failed > 0) {
			files.push(`\u{274C} **${r.files.failed} ${noun(r.files.failed, 'failure', 'failures')}**`);
		}
		if (r.files.passed > 0) {
			files.push(`\u{2705} **${r.files.passed} ${noun(r.files.passed, 'pass', 'passes')}**`);
		}
		files.push(`${r.files.failed + r.files.passed} total`);
	}
	if (r.failed > 0) {
		tests.push(`\u{274C} **${r.failed} ${noun(r.failed, 'failure', 'failures')}**`);
	}
	if (r.passed > 0) {
		tests.push(`\u{2705} **${r.passed} ${noun(r.passed, 'pass', 'passes')}**`);
	}
	if (r.expectedFailures > 0) {
		tests.push(`\u{1F535} **${r.expectedFailures} expected ${noun(r.expectedFailures, 'failure', 'failures')}**`);
	}
	tests.push(`${r.failed + r.passed + r.expectedFailures} total`);
	if (r.skipped > 0) {
		other.push(`${r.skipped} ${noun(r.skipped, 'skip', 'skips')}`, `${r.skipped} total`);
	}
	let out = '## Vitest Test Report\n\n### Summary\n\n';
	if (r.files) {
		out += `- **Test Files**: ${files.join(SEP)}\n`;
	}
	out += `- **Test Results**: ${tests.join(SEP)}\n`;
	if (other.length > 0) {
		out += `- **Other**: ${other.join(SEP)}\n`;
	}
	return out;
}

function vitestFailures(lane: Lane, shown: FailedTest[]): string {
	if (shown.length === 0) {
		return '';
	}
	const items = shown.map(t => {
		const name = t.title === t.file ? t.file : `${t.file} > ${t.title}`;
		return `- \`${name}\` - ${logLinks(lane, t.shard)}`;
	});
	return `\n### Failed\n\n${items.join('\n')}\n`;
}

function e2eHeader(r: Results): string {
	let out = `\u{1F9EA} Total: ${r.passed + r.failed + r.flaky + r.skipped} | \u{2705} Pass: ${r.passed} | \u{274C} Fail: ${r.failed}`;
	if (r.flaky > 0) {
		out += ` | \u{26A0}\u{FE0F} Flaky: ${r.flaky}`;
	}
	if (r.skipped > 0) {
		out += ` | \u{23ED}\u{FE0F} Skipped: ${r.skipped}`;
	}
	return out + '\n';
}

function e2eDetails(lane: Lane, shown: { test: FailedTest; flaky: boolean }[]): string {
	const files = new Map<string, { test: FailedTest; flaky: boolean }[]>();
	for (const s of shown) {
		files.set(s.test.file, [...(files.get(s.test.file) ?? []), s]);
	}
	const failedFiles = [...files].filter(([, ts]) => ts.some(t => !t.flaky));
	const flakyFiles = [...files].filter(([, ts]) => ts.every(t => t.flaky));
	const block = ([file, ts]: [string, { test: FailedTest; flaky: boolean }[]], icon: string): string => {
		const items = ts.map(t => `- \`${t.test.title}\` - ${logLinks(lane, t.test.shard)}`).join('\n');
		return `<details><summary>${icon} <code>${escapeHtml(file)}</code></summary>\n\n${items}\n</details>\n`;
	};
	const blocks = [...failedFiles.map(f => block(f, '\u{274C}')), ...flakyFiles.map(f => block(f, '\u{26A0}\u{FE0F}'))];
	return blocks.length > 0 ? '\n' + blocks.join('\n') : '';
}

/** Failed jobs and their failed steps, for lanes with no readable results. */
function failedJobList(lane: Lane): string {
	const items = failedJobs(lane).map(j => {
		const steps = (j.steps ?? []).filter(s => s.conclusion === 'failure').map(s => `\`${s.name}\``);
		return `- ${j.name}${steps.length > 0 ? ': ' + steps.join(', ') : ''} - [log](${j.html_url})`;
	});
	return items.length > 0 ? `\n### Failed jobs\n\n${items.join('\n')}\n` : '';
}

function cacheDetails(cache: CacheEntry[]): string {
	const items = cache.map(c => `- ${c.name} ${c.hit ? '\u{2705} hit' : '\u{274C} miss'}`).join('\n');
	return `\n<details><summary>Cache</summary>\n\n${items}\n</details>\n`;
}

function laneBody(lane: Lane, results: Results | null, shownCount: number): { body: string; total: number } {
	const failing = lane.state === 'failure';
	if (!results) {
		return { body: failing ? failedJobList(lane) : '', total: 0 };
	}
	const entries = [
		...[...results.failures].sort(byFile).map(test => ({ test, flaky: false })),
		...[...results.flakyTests].sort(byFile).map(test => ({ test, flaky: true })),
	];
	const shown = entries.slice(0, shownCount);
	let body: string;
	if (results.kind === 'vitest') {
		body = vitestStats(results) + vitestFailures(lane, shown.map(s => s.test));
	} else {
		body = e2eHeader(results) + e2eDetails(lane, shown);
	}
	if (failing && results.failures.length === 0) {
		body += failedJobList(lane);
	}
	return { body, total: entries.length };
}

function laneSummary(lane: Lane, runUrl: string, results: Results | null, cache: CacheEntry[] | null): string {
	const tail = (more: number): string => {
		const note = more > 0 ? `\n_${more} more not shown. See the full run._\n` : '';
		return `${note}${cache ? cacheDetails(cache) : ''}\n${runLink(runUrl)}\n`;
	};
	const total = laneBody(lane, results, Infinity).total;
	// Binary search for the most entries that fit under the cap.
	let lo = 0;
	let hi = total;
	const fits = (n: number): boolean => laneBody(lane, results, n).body.length + tail(total - n).length <= MAX_SUMMARY;
	if (!fits(total)) {
		while (lo < hi) {
			const mid = Math.ceil((lo + hi) / 2);
			if (fits(mid)) {
				lo = mid;
			} else {
				hi = mid - 1;
			}
		}
		return laneBody(lane, results, lo).body + tail(total - lo);
	}
	return laneBody(lane, results, total).body + tail(0);
}

/** Renders the check page for one lane. */
export function renderLane(lane: Lane, runUrl: string, results: Results | null, cache: CacheEntry[] | null): CheckOutput {
	const summary = laneSummary(lane, runUrl, results, cache);
	if (lane.state === 'in_progress') {
		return { status: 'in_progress', title: 'Running', summary };
	}
	if (lane.state === 'cancelled') {
		return { status: 'completed', conclusion: 'cancelled', title: 'Cancelled', summary };
	}
	if (lane.state === 'success') {
		return { status: 'completed', conclusion: 'success', title: results ? `${results.passed} passed` : 'Passed', summary };
	}
	const failed = results?.failed ?? 0;
	const title = failed > 0 ? `${failed} ${noun(failed, 'test', 'tests')} failed` : 'Failed';
	return { status: 'completed', conclusion: 'failure', title, summary };
}

/** Renders the check page for a lane whose results could not be used. */
export function renderUnreadable(runUrl: string, reason: 'unreadable' | 'timed_out' | 'cancelled'): CheckOutput {
	const link = `\n${runLink(runUrl)}\n`;
	switch (reason) {
		case 'timed_out':
			return { status: 'completed', conclusion: 'timed_out', title: 'Timed out', summary: `The tests were still running after two hours.\n${link}` };
		case 'cancelled':
			return { status: 'completed', conclusion: 'cancelled', title: 'Cancelled', summary: `The test run was cancelled.\n${link}` };
		default:
			return { status: 'completed', conclusion: 'neutral', title: 'Could not read the test run', summary: `The test run finished, but its results could not be read.\n${link}` };
	}
}

/** Renders the `required-tests` job step summary. */
export function renderRequiredSummary(jobs: Job[], runUrl: string): string {
	let out = '';
	const resolve = jobs.find(j => j.name.startsWith('resolve') && !j.name.includes(' / '));
	if (resolve?.conclusion === 'failure') {
		const step = (resolve.steps ?? []).find(s => s.conclusion === 'failure');
		if (step) {
			out += `Could not prepare the PR for testing: \`${step.name}\` - [log](${resolve.html_url})\n\n`;
		}
	}
	out += `${runLink(runUrl)}\n\n`;
	out += 'To re-run the tests, re-run required-tests on this PR. Re-running jobs in positron-builds does not update the PR.\n';
	return out;
}
