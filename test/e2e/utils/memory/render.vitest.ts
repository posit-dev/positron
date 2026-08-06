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
