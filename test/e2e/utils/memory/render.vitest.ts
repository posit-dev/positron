/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { formatBytes, renderHtml, renderMarkdown } from './render.js';
import { ActivatedExtension, LabeledProcess, MemorySnapshot } from './types.js';

const MB = 1024 * 1024;

const proc = (overrides: Partial<LabeledProcess> = {}): LabeledProcess => ({
	pid: 100, ppid: 1, depth: 0, processName: 'positron', processRole: 'main',
	labeled: true, cmdBasename: 'positron', pssBytes: 100 * MB, rssBytes: 200 * MB,
	pssMin: 100 * MB, pssMax: 100 * MB, ...overrides
});

const ext = (extensionId: string, activationEvent: string | null): ActivatedExtension =>
	({ extensionId, isBuiltin: true, activationTimeMs: null, activationEvent });

const snapshot = (procs: LabeledProcess[], launchIndex = 0, extensions: ActivatedExtension[] = []): MemorySnapshot => ({
	scenario: 'idle', capturedAt: '2026-08-11T00:00:00.000Z',
	positronVersion: '2026.09.0-35', launchIndex, settleMs: 12_000,
	treeTotalPssBytes: procs.reduce((sum, p) => sum + p.pssBytes, 0),
	processes: procs, extensions
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
	test('names the scenario in the heading, so two reports cannot be confused', () => {
		const markdown = renderMarkdown([{ ...snapshot([proc()]), scenario: 'session-python' }], undefined);
		expect(markdown).toContain('## Memory: session-python');
	});

	test('reports the total', () => {
		const output = renderMarkdown([snapshot([proc()])]);
		expect(output).toContain('100.0 MB');
	});

	test('names the build that produced the numbers', () => {
		const output = renderMarkdown([snapshot([proc()])]);
		expect(output).toContain('**Build: 2026.09.0-35**');
	});

	test('omits the build line when the snapshot cannot name one', () => {
		const output = renderMarkdown([{ ...snapshot([proc()]), positronVersion: '' }]);
		expect(output).not.toContain('Build:');
	});

	test('shows a delta against the baseline', () => {
		const current = snapshot([proc({ pssBytes: 150 * MB })]);
		const baseline = snapshot([proc({ pssBytes: 100 * MB })]);
		const output = renderMarkdown([current], baseline);
		expect(output).toMatch(/\+50\.0 MB/);
	});

	test('flags unlabeled processes in the role table', () => {
		const output = renderMarkdown([snapshot([proc({ processRole: 'unlabeled', labeled: false, processName: 'mystery' })])]);
		expect(output).toContain('unlabeled');
	});

	test('reports the same unlabeled total in the role table across launches', () => {
		// Three launches whose unlabeled totals differ, so a summary of launch 0
		// alone would disagree with the median in the table.
		const unlabeled = (pssBytes: number): LabeledProcess =>
			proc({ pid: 300, processName: 'mystery', processRole: 'unlabeled', labeled: false, pssBytes });
		const output = renderMarkdown([
			snapshot([unlabeled(90 * MB)], 0),
			snapshot([unlabeled(50 * MB)], 1),
			snapshot([unlabeled(40 * MB)], 2)
		]);
		expect(output).toContain('| `unlabeled` | 50.0 MB |');
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

	test('works with no baseline', () => {
		expect(() => renderMarkdown([snapshot([proc()])])).not.toThrow();
	});

	test('aggregates across launches by role', () => {
		const output = renderMarkdown([snapshot([proc()], 0), snapshot([proc({ pssBytes: 120 * MB })], 1)]);
		// Median of the two launch totals.
		expect(output).toContain('110.0 MB');
	});

	test('stays compact: no per-process table in the step summary', () => {
		// This is the whole point of the change: the giant per-process table made
		// the GitHub step summary unreadable. That detail now lives only in the HTML.
		const tree = [
			proc({ processName: 'extension-host [1]', processRole: 'extension_host', pssBytes: 475 * MB }),
			proc({ pid: 2, processName: 'quarto.quarto (lsp)', processRole: 'language_server', pssBytes: 101 * MB }),
			proc({ pid: 3, processName: 'positron-duckdb (duckdb-worker)', processRole: 'extension_child', pssBytes: 86 * MB }),
		];
		const output = renderMarkdown([snapshot(tree, 0, [ext('github.copilot', 'onStartupFinished')])]);
		expect(output).not.toContain('quarto.quarto (lsp)');
		expect(output).not.toContain('positron-duckdb (duckdb-worker)');
		expect(output).not.toContain('github.copilot');
		expect(output).not.toContain('| Process |');
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

	test('indents a deeper process further than a shallower one', () => {
		const output = renderHtml([snapshot([
			proc({ pid: 100, depth: 0, processName: 'positron' }),
			proc({ pid: 101, depth: 1, processName: 'extension-host [1]', processRole: 'extension_host' }),
			proc({ pid: 102, depth: 3, processName: 'kcserver', processRole: 'kernel_supervisor' }),
		])]);
		const indent = (name: string) => {
			const match = output.match(new RegExp(`padding-left:(\\d+)px">${name}`));
			expect(match).not.toBeNull();
			return Number(match![1]);
		};
		expect(indent('positron')).toBeLessThan(indent('extension-host \\[1\\]'));
		expect(indent('extension-host \\[1\\]')).toBeLessThan(indent('kcserver'));
	});

	test('escapes names so a window title cannot inject markup', () => {
		const output = renderHtml([snapshot([proc({ processName: 'window [1] (<script>alert(1)</script>)' })])]);
		expect(output).not.toContain('<script>alert(1)</script>');
		expect(output).toContain('&lt;script&gt;');
	});

	test('renders a delta with both a glyph and a signed number, not color alone', () => {
		const current = snapshot([proc({ pssBytes: 150 * MB })]);
		const baseline = snapshot([proc({ pssBytes: 100 * MB })]);
		const output = renderHtml([current], baseline);
		expect(output).toMatch(/&#9650;[^<]*\+50\.0 MB/);
	});

	test('renders a decrease with the down glyph and a negative number', () => {
		const current = snapshot([proc({ pssBytes: 80 * MB })]);
		const baseline = snapshot([proc({ pssBytes: 100 * MB })]);
		const output = renderHtml([current], baseline);
		expect(output).toMatch(/&#9660;[^<]*-20\.0 MB/);
	});

	test('sizes the magnitude bar proportionally to PSS', () => {
		const output = renderHtml([snapshot([
			proc({ pid: 100, processName: 'big', pssBytes: 400 * MB }),
			proc({ pid: 101, processName: 'small', processRole: 'kernel', pssBytes: 40 * MB }),
		])]);
		const widths = [...output.matchAll(/bar-fill" style="width:([\d.]+)%"/g)].map(m => Number(m[1]));
		expect(widths.length).toBeGreaterThanOrEqual(2);
		expect(Math.max(...widths)).toBeGreaterThan(Math.min(...widths));
	});

	test('groups activated extensions by activation event', () => {
		const output = renderHtml([snapshot([proc()], 0, [
			ext('github.copilot', 'onStartupFinished'),
			ext('ms-python.python', 'onLanguage:python'),
		])]);
		expect(output).toContain('onStartupFinished');
		expect(output).toContain('onLanguage:python');
		expect(output).toContain('github.copilot');
		expect(output).toContain('ms-python.python');
	});

	// Isolates the process-tree table from the header and role table, both of
	// which also render a total delta, so a match here cannot be a false
	// positive from one of those.
	const treeSection = (output: string) => output.split('Process tree')[1].split('</table>')[0];

	test('shows each process delta against the baseline', () => {
		const tree = [
			proc({ processName: 'extension-host [1]', processRole: 'extension_host', pssBytes: 475 * MB }),
			proc({ pid: 2, processName: 'quarto.quarto (lsp)', processRole: 'language_server', pssBytes: 101 * MB }),
			proc({ pid: 3, processName: 'json-language-features (jsonServerMain)', processRole: 'language_server', pssBytes: 40 * MB }),
		];
		const baseline = snapshot([
			proc({ processName: 'extension-host [1]', processRole: 'extension_host', pssBytes: 475 * MB }),
			proc({ pid: 2, processName: 'quarto.quarto (lsp)', processRole: 'language_server', pssBytes: 81 * MB }),
			proc({ pid: 3, processName: 'json-language-features (jsonServerMain)', processRole: 'language_server', pssBytes: 40 * MB }),
		]);
		const output = renderHtml([snapshot(tree)], baseline);
		// Both processes share the `language_server` role, so a role-level delta
		// could not say which one moved. The per-process row must.
		expect(treeSection(output)).toMatch(/quarto\.quarto \(lsp\)[\s\S]*&#9650;[^<]*\+20\.0 MB/);
	});

	test('marks a process absent from the baseline as new in the tree, not a fabricated delta', () => {
		const current = snapshot([proc(), proc({ pid: 200, processName: 'duckdb-worker', processRole: 'unlabeled', pssBytes: 86 * MB })]);
		const baseline = snapshot([proc()]);
		const output = renderHtml([current], baseline);
		expect(treeSection(output)).toMatch(/duckdb-worker[\s\S]*delta-flat">new</);
	});

	test('renders no delta at all in the tree when there is no baseline', () => {
		const output = renderHtml([snapshot([proc()])]);
		const tree = treeSection(output);
		expect(tree).not.toMatch(/delta-up|delta-down|delta-flat/);
		// The row's last cell must be empty, not a fabricated zero.
		expect(tree).toMatch(/<td align="right"><\/td>\s*<\/tr>/);
	});

	test('calls out a process that is new since the baseline', () => {
		const current = snapshot([proc(), proc({ pid: 200, processName: 'duckdb-worker', processRole: 'unlabeled', pssBytes: 100 * MB })]);
		const baseline = snapshot([proc()]);
		const output = renderHtml([current], baseline);
		expect(output).toContain('duckdb-worker');
		expect(output.toLowerCase()).toContain('new since the previous nightly');
	});

	test('surfaces a process that appears in a later launch only', () => {
		// Reading launch 0 alone would miss it, which is exactly the intermittent
		// regression this section exists to catch.
		const latecomer = proc({ pid: 500, processName: 'duckdb-worker', processRole: 'unlabeled', labeled: false, pssBytes: 30 * MB });
		const output = renderHtml(
			[snapshot([proc()], 0), snapshot([proc(), latecomer], 1)],
			snapshot([proc()])
		);
		expect(output).toContain('duckdb-worker');
	});

	test('says nothing about new processes when there is no baseline, or nothing appeared', () => {
		expect(renderHtml([snapshot([proc()])])).not.toContain('New since the previous nightly');
	});

	test('flags unlabeled processes so a new one cannot hide', () => {
		const output = renderHtml([snapshot([proc({ processRole: 'unlabeled', labeled: false, processName: 'mystery' })])]);
		expect(output).toContain('unlabeled');
	});

	test('reports the same unlabeled total in the note as in the role table', () => {
		// Three launches whose unlabeled totals differ, so a note summing launch 0
		// alone would disagree with the median in the table.
		const unlabeled = (pssBytes: number): LabeledProcess =>
			proc({ pid: 300, processName: 'mystery', processRole: 'unlabeled', labeled: false, pssBytes });
		const output = renderHtml([
			snapshot([unlabeled(90 * MB)], 0),
			snapshot([unlabeled(50 * MB)], 1),
			snapshot([unlabeled(40 * MB)], 2)
		]);
		expect(output).toContain('50.0 MB');
		expect(output).toContain('50.0 MB in the median launch');
		expect(output).not.toContain('90.0 MB in the median launch');
	});

	test('lists extensions that activate eagerly', () => {
		const output = renderHtml([snapshot([proc()], 0, [
			ext('github.copilot', 'onStartupFinished'),
			ext('posit.assistant', '*'),
			ext('ms-python.python', 'onLanguage:python'),
			ext('vscode.git', 'workspaceContains:.git'),
		])]);
		expect(output).toContain('github.copilot');
		expect(output).toContain('posit.assistant');
	});

	test('leaves demand-activated extensions out of the eager card', () => {
		// The deck asks people to stop adding eager activations. Listing every
		// activation would bury that signal among the demand-activated ones.
		const output = renderHtml([snapshot([proc()], 0, [
			ext('github.copilot', 'onStartupFinished'),
			ext('ms-python.python', 'onLanguage:python'),
			ext('vscode.git', 'workspaceContains:.git'),
		])]);
		const eagerCard = output.split('Eagerly activated extensions')[1].split('<h2>Activated extensions')[0];
		expect(eagerCard).not.toContain('ms-python.python');
		expect(eagerCard).not.toContain('vscode.git');
	});

	test('calls out an extension that is newly eager', () => {
		// Newly eager includes an extension that was present before but activated
		// on demand, which an id-only diff would miss entirely.
		const eager = [
			ext('github.copilot', 'onStartupFinished'),
			ext('posit.assistant', '*'),
			ext('quarto.quarto', 'onStartupFinished'),
		];
		const baseline = snapshot([proc()], 0, [ext('github.copilot', 'onStartupFinished'), ext('quarto.quarto', 'onLanguage:quarto')]);
		const output = renderHtml([snapshot([proc()], 0, eager)], baseline);
		expect(output).toMatch(/[Nn]ewly eager/);
		expect(output).toContain('quarto.quarto');
	});

	test('puts the worse event first, because * beats onStartupFinished to the punch', () => {
		const mixed = [
			ext('vscode.git', '*'),
			ext('posit.assistant', 'onStartupFinished'),
			ext('vscode.git-base', '*'),
			ext('GitHub.vscode-pull-request-github', 'onStartupFinished'),
			ext('ms-python.python', 'onLanguage:python'),
		];
		const output = renderHtml([snapshot([proc()], 0, mixed)]);
		expect(output.indexOf('<code>*</code>')).toBeLessThan(output.indexOf('onStartupFinished'));
	});
});
