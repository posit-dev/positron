/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { formatBytes, renderHtml, renderMarkdown } from './render.js';
import { LabeledProcess, MemorySnapshot } from './types.js';

const MB = 1024 * 1024;

const proc = (overrides: Partial<LabeledProcess> = {}): LabeledProcess => ({
	pid: 100, ppid: 1, depth: 0, processName: 'positron', processRole: 'main',
	labeled: true, cmdBasename: 'positron', pssBytes: 100 * MB, rssBytes: 200 * MB,
	pssMin: 100 * MB, pssMax: 100 * MB, ...overrides
});

const snapshot = (procs: LabeledProcess[], launchIndex = 0): MemorySnapshot => ({
	scenario: 'idle', launchIndex, settleMs: 12_000,
	treeTotalPssBytes: procs.reduce((sum, p) => sum + p.pssBytes, 0),
	processes: procs, extensions: []
});

describe('formatBytes', () => {
	test('renders megabytes with one decimal', () => {
		expect(formatBytes(100 * MB)).toBe('100.0 MB');
	});
	test('renders gigabytes above 1024 MB', () => {
		expect(formatBytes(2048 * MB)).toBe('2.0 GB');
	});
});

describe('renderMarkdown', () => {
	test('reports the total', () => {
		const output = renderMarkdown([snapshot([proc()])]);
		expect(output).toContain('100.0 MB');
	});

	test('shows a delta against the baseline', () => {
		const current = snapshot([proc({ pssBytes: 150 * MB })]);
		const baseline = snapshot([proc({ pssBytes: 100 * MB })]);
		const output = renderMarkdown([current], baseline);
		expect(output).toMatch(/\+50\.0 MB/);
	});

	test('calls out a process that is new since the baseline', () => {
		const current = snapshot([proc(), proc({ pid: 200, processName: 'duckdb-worker', processRole: 'unlabeled', pssBytes: 100 * MB })]);
		const baseline = snapshot([proc()]);
		const output = renderMarkdown([current], baseline);
		expect(output).toContain('duckdb-worker');
		expect(output.toLowerCase()).toContain('new');
	});

	test('flags unlabeled processes so a new one cannot hide', () => {
		const output = renderMarkdown([snapshot([proc({ processRole: 'unlabeled', labeled: false, processName: 'mystery' })])]);
		expect(output).toContain('unlabeled');
	});

	test('reports the same unlabeled total in the note as in the role table', () => {
		// Three launches whose unlabeled totals differ, so a note summing launch 0
		// alone would disagree with the median in the table.
		const unlabeled = (pssBytes: number): LabeledProcess =>
			proc({ pid: 300, processName: 'mystery', processRole: 'unlabeled', labeled: false, pssBytes });
		const output = renderMarkdown([
			snapshot([unlabeled(90 * MB)], 0),
			snapshot([unlabeled(50 * MB)], 1),
			snapshot([unlabeled(40 * MB)], 2)
		]);
		expect(output).toContain('| `unlabeled` | 50.0 MB |');
		expect(output).toContain('50.0 MB in the median launch');
		expect(output).not.toContain('90.0 MB in the median launch');
	});

	test('treats a role absent from a launch as zero, not as a missing sample', () => {
		// `kernel` appears in one launch of three. Taking the median of only the
		// launches it appeared in would report it at its full 90 MB, as heavy as a
		// role present every time.
		const kernel = proc({ pid: 400, processName: 'ark', processRole: 'kernel', pssBytes: 90 * MB });
		const output = renderMarkdown([
			snapshot([proc(), kernel], 0),
			snapshot([proc()], 1),
			snapshot([proc()], 2)
		]);
		expect(output).toContain('| `kernel` | 0.0 MB |');
	});

	test('surfaces a process that appears in a later launch only', () => {
		// Reading launch 0 alone would miss it, which is exactly the intermittent
		// regression this section exists to catch.
		const latecomer = proc({ pid: 500, processName: 'duckdb-worker', processRole: 'unlabeled', labeled: false, pssBytes: 30 * MB });
		const output = renderMarkdown(
			[snapshot([proc()], 0), snapshot([proc(), latecomer], 1)],
			snapshot([proc()])
		);
		expect(output).toContain('duckdb-worker');
	});

	test('counts unlabeled processes across every launch', () => {
		const first = proc({ pid: 600, processName: 'mystery-a', processRole: 'unlabeled', labeled: false, pssBytes: 10 * MB });
		const second = proc({ pid: 601, processName: 'mystery-b', processRole: 'unlabeled', labeled: false, pssBytes: 10 * MB });
		const output = renderMarkdown([snapshot([first], 0), snapshot([second], 1)]);
		expect(output).toContain('2 unlabeled process name(s) across 2 launch(es)');
		// Naming them is what makes the note actionable for label.ts.
		expect(output).toContain('`mystery-a`');
		expect(output).toContain('`mystery-b`');
	});

	test('truncates a command-line process name in the unlabeled note', () => {
		// Unnamed children are reported by their full command line.
		const long = '/build/positron /build/resources/app/extensions/json-language-features/server/dist/node/jsonServerMain --node-ipc';
		const output = renderMarkdown([snapshot([proc({ processName: long, processRole: 'unlabeled', labeled: false })])]);
		expect(output).toContain('...');
		expect(output).not.toContain('--node-ipc');
	});

	test('works with no baseline', () => {
		expect(() => renderMarkdown([snapshot([proc()])])).not.toThrow();
	});

	test('aggregates across launches by role', () => {
		const output = renderMarkdown([snapshot([proc()], 0), snapshot([proc({ pssBytes: 120 * MB })], 1)]);
		// Median of the two launch totals.
		expect(output).toContain('110.0 MB');
	});
});

describe('renderHtml', () => {
	test('produces a self-contained document', () => {
		const output = renderHtml([snapshot([proc()])]);
		expect(output).toContain('<!DOCTYPE html>');
		expect(output).toContain('</html>');
	});

	test('indents the tree by depth', () => {
		const output = renderHtml([snapshot([proc(), proc({ pid: 101, depth: 2, processName: 'kcserver' })])]);
		expect(output).toContain('kcserver');
	});

	test('escapes names so a window title cannot inject markup', () => {
		const output = renderHtml([snapshot([proc({ processName: 'window [1] (<script>alert(1)</script>)' })])]);
		expect(output).not.toContain('<script>alert(1)</script>');
		expect(output).toContain('&lt;script&gt;');
	});
});
