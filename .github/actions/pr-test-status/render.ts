/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Job, Lane } from './lanes.ts';
import { sanitizeName, type CacheEntry, type FailedTest, type Results } from './results.ts';

/** A lane's result: status, conclusion, one-line title, and its details for the run summary. */
export type LaneOutput = {
	status: 'in_progress' | 'completed';
	conclusion?: 'success' | 'failure' | 'cancelled' | 'neutral' | 'timed_out';
	title: string;
	summary: string;
};

// Keeps one lane's details well under the 1 MiB step summary cap.
const MAX_SUMMARY = 60000;

const noun = (n: number, one: string, many: string): string => n === 1 ? one : many;
const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const byFile = (a: FailedTest, b: FailedTest): number => a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
/** A code span for a name: backticks and line breaks removed, `(unnamed)` if nothing is left. */
const code = (s: string): string => `\`${sanitizeName(s) || '(unnamed)'}\``;

const escapeCell = (s: string): string => s.replace(/\|/g, '\\|');

function failedJobs(lane: Lane): Job[] {
	return lane.jobs.filter(j => j.conclusion === 'failure' || j.conclusion === 'timed_out');
}

/** A shard job's name ends in `-<digits>`; `-scan-<digits>` jobs are not shards. */
const SHARD_JOB = /(?<!-scan)-(?<n>\d+)$/;

/** Log links for a test: its shard's job if known, else every failed job of the lane. */
function logLinks(lane: Lane, shard: number | null): string {
	const own = shard === null ? undefined : lane.jobs.find(j => SHARD_JOB.exec(j.name)?.groups?.n === String(shard));
	const jobs = own ? [own] : failedJobs(lane);
	return jobs.map(j => `[log](${j.html_url})`).join(' ');
}

/** One line per test: file and title, a flaky marker, and its log links. */
function testList(lane: Lane, shown: { test: FailedTest; flaky: boolean }[]): string {
	const items = shown.map(({ test, flaky }) => {
		const title = sanitizeName(test.title);
		const name = title === '' || title === test.file ? code(test.file) : `${code(test.file)} > ${code(title)}`;
		return `- ${flaky ? '\u{26A0}\u{FE0F} ' : ''}${name}${flaky ? ' (flaky)' : ''} - ${logLinks(lane, test.shard)}`;
	});
	return items.length > 0 ? items.join('\n') + '\n' : '';
}

function cacheList(cache: CacheEntry[]): string {
	const items = cache.map(c => `- ${code(c.name)} ${c.hit ? '\u{2705} hit' : '\u{274C} miss'}`).join('\n');
	return `\n**Cache**\n\n${items}\n`;
}

function laneBody(lane: Lane, results: Results | null, shownCount: number): { body: string; total: number } {
	if (!results) {
		return { body: '', total: 0 };
	}
	const entries = [
		...[...results.failures].sort(byFile).map(test => ({ test, flaky: false })),
		...[...results.flakyTests].sort(byFile).map(test => ({ test, flaky: true })),
	];
	return { body: testList(lane, entries.slice(0, shownCount)), total: entries.length };
}

function laneSummary(lane: Lane, results: Results | null, cache: CacheEntry[] | null): string {
	const tail = (more: number): string => {
		const note = more > 0 ? `\n_${more} more not shown. See the full run._\n` : '';
		return `${note}${cache ? cacheList(cache) : ''}`;
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

/** Where a running lane links: its job's log if it has one job, else the whole builds run. */
export function laneUrl(lane: Lane, runUrl: string): string {
	return lane.jobs.length === 1 ? lane.jobs[0].html_url : runUrl;
}

const ICON: Record<NonNullable<LaneOutput['conclusion']>, string> = {
	failure: '\u{274C}', timed_out: '\u{26A0}\u{FE0F}', neutral: '\u{26A0}\u{FE0F}', cancelled: '\u{26AA}', success: '\u{2705}',
};
const RANK = ['failure', 'timed_out', 'neutral', 'cancelled', undefined, 'success'];
const icon = (out: LaneOutput): string => out.conclusion ? ICON[out.conclusion] : '\u{23F3}';

/**
 * Renders the lanes for the required-tests run summary: a table with a row per
 * lane, failures first, then a folded section for each lane with details.
 */
export function renderLanes(lanes: { lane: Lane; out: LaneOutput }[], runUrl: string): string {
	const sorted = [...lanes].sort((a, b) => RANK.indexOf(a.out.conclusion) - RANK.indexOf(b.out.conclusion) || (a.lane.name < b.lane.name ? -1 : 1));
	const rows = sorted.map(({ lane, out }) => {
		const link = out.conclusion === 'success' ? '' : ` - [${lane.jobs.length === 1 ? 'log' : 'run'}](${laneUrl(lane, runUrl)})`;
		return `| ${icon(out)} | ${escapeCell(code(lane.name))} | ${out.title}${link} |`;
	});
	const sections = sorted.filter(({ out }) => out.summary !== '').map(({ lane, out }) =>
		`<details><summary>${icon(out)} <code>${escapeHtml(sanitizeName(lane.name) || '(unnamed)')}</code>: ${out.title}</summary>\n\n${out.summary}\n</details>\n`);
	return ['| | Lane | Result |', '|---|---|---|', ...rows].join('\n') + '\n\n' + sections.join('\n');
}

/** Renders one lane's result. */
export function renderLane(lane: Lane, results: Results | null, cache: CacheEntry[] | null): LaneOutput {
	const summary = laneSummary(lane, results, cache);
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

/** Renders the result for a lane whose results could not be used. */
export function renderUnreadable(reason: 'unreadable' | 'timed_out' | 'cancelled'): LaneOutput {
	switch (reason) {
		case 'timed_out':
			return { status: 'completed', conclusion: 'timed_out', title: 'Timed out', summary: `The tests were still running after two hours.\n` };
		case 'cancelled':
			return { status: 'completed', conclusion: 'cancelled', title: 'Cancelled', summary: `The test run was cancelled.\n` };
		default:
			return { status: 'completed', conclusion: 'neutral', title: 'Could not read the test run', summary: `The test results could not be read.\n` };
	}
}

/** Renders the `required-tests` job step summary. */
export function renderRequiredSummary(jobs: Job[]): string {
	let out = '';
	const resolve = jobs.find(j => j.name.startsWith('resolve') && !j.name.includes(' / '));
	if (resolve?.conclusion === 'failure') {
		const step = (resolve.steps ?? []).find(s => s.conclusion === 'failure');
		if (step) {
			out += `Could not prepare the PR for testing: ${code(step.name)} - [log](${resolve.html_url})\n\n`;
			if (step.name === 'Wait for the merge commit') {
				out += 'The PR may have conflicts with its base, or GitHub had not finished preparing its merge commit.\n\n';
			}
		}
	}
	out += '<sub>To re-run the tests, re-run required-tests on this PR. Re-running jobs in positron-builds does not update the PR.</sub>\n';
	return out;
}
