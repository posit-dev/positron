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

// Keeps one lane's details, and the whole page, under the 1 MiB step summary cap (in bytes).
const MAX_SUMMARY = 60000;
const MAX_PAGE = 900000;
const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');

const noun = (n: number, one: string, many: string): string => n === 1 ? one : many;
const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const byFile = (a: FailedTest, b: FailedTest): number => a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
/** A code span for a name: backticks and line breaks removed, `(unnamed)` if nothing is left. */
const code = (s: string): string => `\`${sanitizeName(s) || '(unnamed)'}\``;

const escapeCell = (s: string): string => s.replace(/\|/g, '\\|');

function failedJobs(lane: Lane): Job[] {
	return lane.jobs.filter(j => j.conclusion === 'failure' || j.conclusion === 'timed_out');
}

type Entry = { test: FailedTest; flaky: boolean };

/** One line per test: file and title, and a flaky marker. */
function testList(shown: Entry[]): string {
	const items = shown.map(({ test, flaky }) => {
		const title = sanitizeName(test.title);
		const name = title === '' || title === test.file ? code(test.file) : `${code(test.file)} > ${code(title)}`;
		return `- ${flaky ? '\u{26A0}\u{FE0F} ' : ''}${name}${flaky ? ' (flaky)' : ''}`;
	});
	return items.length > 0 ? items.join('\n') + '\n' : '';
}

function cacheList(cache: CacheEntry[]): string {
	const items = cache.map(c => `- ${code(c.name)} ${c.hit ? '\u{2705} hit' : '\u{274C} miss'}`).join('\n');
	return `\n**Cache**\n\n${items}\n`;
}

function laneSummary(results: Results | null, cache: CacheEntry[] | null): string {
	const entries: Entry[] = results ? [
		...[...results.failures].sort(byFile).map(test => ({ test, flaky: false })),
		...[...results.flakyTests].sort(byFile).map(test => ({ test, flaky: true })),
	] : [];
	const total = entries.length;
	const body = (n: number): string => testList(entries.slice(0, n));
	const tail = (more: number): string => {
		const note = more > 0 ? `\n_${more} more not shown. See the full run._\n` : '';
		return `${note}${cache ? cacheList(cache) : ''}`;
	};
	const fits = (n: number): boolean => bytes(body(n)) + bytes(tail(total - n)) <= MAX_SUMMARY;
	if (fits(total)) {
		return body(total) + tail(0);
	}
	// Binary search for the most entries that fit under the cap.
	let lo = 0;
	let hi = total;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (fits(mid)) {
			lo = mid;
		} else {
			hi = mid - 1;
		}
	}
	return body(lo) + tail(total - lo);
}

/** Where a lane links: its one failed job, else its only job, else the whole builds run. */
export function laneUrl(lane: Lane, runUrl: string): string {
	const failed = failedJobs(lane);
	if (failed.length === 1) {
		return failed[0].html_url;
	}
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
		const url = laneUrl(lane, runUrl);
		const link = out.conclusion === 'success' ? '' : ` - [${url === runUrl ? 'run' : 'log'}](${url})`;
		return `| ${icon(out)} | ${escapeCell(code(lane.name))} | ${out.title}${link} |`;
	});
	const table = ['| | Lane | Result |', '|---|---|---|', ...rows].join('\n') + '\n\n';
	const sections: string[] = [];
	let size = bytes(table);
	let dropped = 0;
	for (const { lane, out } of sorted.filter(({ out }) => out.summary !== '')) {
		const section = `<details><summary>${icon(out)} <code>${escapeHtml(sanitizeName(lane.name) || '(unnamed)')}</code>: ${out.title}</summary>\n\n${out.summary}\n</details>\n`;
		if (dropped === 0 && size + bytes(section) + 1 <= MAX_PAGE) {
			sections.push(section);
			size += bytes(section) + 1;
		} else {
			dropped++;
		}
	}
	const note = dropped > 0 ? `\n_Details for ${dropped} more ${noun(dropped, 'lane', 'lanes')} not shown. See the full run._\n` : '';
	return table + sections.join('\n') + note;
}

/** Renders one lane's result. */
export function renderLane(lane: Lane, results: Results | null, cache: CacheEntry[] | null): LaneOutput {
	const summary = laneSummary(results, cache);
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

/** Renders the status for an open lane closed without a result. Only the title is shown. */
export function renderUnreadable(reason: 'unreadable' | 'timed_out' | 'cancelled'): LaneOutput {
	switch (reason) {
		case 'timed_out':
			return { status: 'completed', conclusion: 'timed_out', title: 'Timed out', summary: '' };
		case 'cancelled':
			return { status: 'completed', conclusion: 'cancelled', title: 'Cancelled', summary: '' };
		default:
			return { status: 'completed', conclusion: 'neutral', title: 'Could not read the test run', summary: '' };
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
