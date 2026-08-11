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
	scenario: 'idle', capturedAt: '2026-08-11T00:00:00.000Z', launchIndex, settleMs: 12_000,
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

describe('top processes', () => {
	// Culprit 1 from the memory-hog deck. The role table already carries these
	// bytes; what it cannot say is that most of `language_server` is Quarto.
	const tree = [
		proc({ processName: 'extension-host [1]', processRole: 'extension_host', pssBytes: 475 * MB }),
		proc({ pid: 2, processName: 'quarto.quarto (lsp)', processRole: 'language_server', pssBytes: 101 * MB }),
		proc({ pid: 3, processName: 'positron-duckdb (duckdb-worker)', processRole: 'extension_child', pssBytes: 86 * MB }),
		proc({ pid: 4, processName: 'positron-python (pet)', processRole: 'extension_child', pssBytes: 9 * MB }),
	];

	test('names the processes behind the roles', () => {
		const output = renderMarkdown([snapshot(tree)]);
		expect(output).toContain('quarto.quarto (lsp)');
		expect(output).toContain('positron-duckdb (duckdb-worker)');
	});

	test('shows each process delta against the baseline', () => {
		const baseline = snapshot([proc({ pid: 2, processName: 'quarto.quarto (lsp)', processRole: 'language_server', pssBytes: 81 * MB })]);
		const output = renderMarkdown([snapshot(tree)], baseline);
		expect(output).toMatch(/quarto\.quarto \(lsp\).*\+20\.0 MB/);
	});

	test('orders by size so the culprit is first', () => {
		const output = renderMarkdown([snapshot(tree)]);
		expect(output.indexOf('quarto.quarto')).toBeLessThan(output.indexOf('positron-python'));
	});
});

describe('startup activations', () => {
	const eager = [
		ext('github.copilot', 'onStartupFinished'),
		ext('posit.assistant', '*'),
		ext('quarto.quarto', 'onStartupFinished'),
	];
	const lazy = [ext('ms-python.python', 'onLanguage:python'), ext('vscode.git', 'workspaceContains:.git')];

	test('lists extensions that activate eagerly', () => {
		const output = renderMarkdown([snapshot([proc()], 0, [...eager, ...lazy])]);
		expect(output).toContain('github.copilot');
		expect(output).toContain('posit.assistant');
	});

	test('leaves demand-activated extensions out', () => {
		// The deck asks people to stop adding eager activations. Listing all 32
		// activations would bury that in the same summary as the process tables.
		const output = renderMarkdown([snapshot([proc()], 0, [...eager, ...lazy])]);
		expect(output).not.toContain('ms-python.python');
		expect(output).not.toContain('vscode.git');
	});

	test('counts them and diffs the count against the baseline', () => {
		const baseline = snapshot([proc()], 0, [ext('github.copilot', 'onStartupFinished')]);
		const output = renderMarkdown([snapshot([proc()], 0, eager)], baseline);
		expect(output).toMatch(/3 eager/);
		expect(output).toMatch(/\+2/);
	});

	test('calls out an extension that is newly eager', () => {
		// Newly eager includes an extension that was present before but activated
		// on demand, which an id-only diff would miss entirely.
		const baseline = snapshot([proc()], 0, [ext('github.copilot', 'onStartupFinished'), ext('quarto.quarto', 'onLanguage:quarto')]);
		const output = renderMarkdown([snapshot([proc()], 0, eager)], baseline);
		expect(output).toMatch(/[Nn]ewly eager/);
		expect(output).toContain('quarto.quarto');
	});

	test('degrades to a count when the baseline carries no activation events', () => {
		// A deployed /memory GET that omits activation_event must not produce a
		// report claiming every extension is newly eager.
		const baseline = snapshot([proc()], 0, [ext('github.copilot', null), ext('posit.assistant', null)]);
		const output = renderMarkdown([snapshot([proc()], 0, eager)], baseline);
		expect(output).toMatch(/3 eager/);
		expect(output).not.toMatch(/[Nn]ewly eager/);
	});

	test('says nothing at all when no extensions were collected', () => {
		const output = renderMarkdown([snapshot([proc()])]);
		expect(output).not.toMatch(/eager/);
	});
});

describe('eager activations grouped by event', () => {
	const mixed = [
		ext('vscode.git', '*'),
		ext('posit.assistant', 'onStartupFinished'),
		ext('vscode.git-base', '*'),
		ext('GitHub.vscode-pull-request-github', 'onStartupFinished'),
		ext('ms-python.python', 'onLanguage:python'),
	];
	const output = () => renderMarkdown([snapshot([proc()], 0, mixed)]);

	test('puts the worse event first, because * beats onStartupFinished to the punch', () => {
		expect(output().indexOf('`*`')).toBeLessThan(output().indexOf('onStartupFinished'));
	});

	test('counts each group', () => {
		expect(output()).toMatch(/`\*` \(2\)/);
		expect(output()).toMatch(/`onStartupFinished` \(2\)/);
	});

	test('lists each extension on its own line, sorted', () => {
		const lines = output().split('\n');
		expect(lines).toContain('- `vscode.git`');
		expect(lines).toContain('- `vscode.git-base`');
		expect(lines.indexOf('- `GitHub.vscode-pull-request-github`')).toBeLessThan(lines.indexOf('- `posit.assistant`'));
	});

	test('drops the old comma-run entirely', () => {
		expect(output()).not.toContain('All eager:');
	});

	test('omits a group nothing used', () => {
		const output = renderMarkdown([snapshot([proc()], 0, [ext('posit.assistant', 'onStartupFinished')])]);
		expect(output).not.toContain('`*`');
		expect(output).toMatch(/`onStartupFinished` \(1\)/);
	});
});

describe('top processes excludes the fixed process skeleton', () => {
	// Nine of fourteen roles hold exactly one process, and for those the process
	// row repeats the role row byte for byte. Listing them spent most of the
	// table restating the table above it and pushed the informative rows off it.
	const tree = [
		proc({ pid: 1, processName: 'positron', processRole: 'main', pssBytes: 165 * MB }),
		proc({ pid: 2, processName: 'window [1] (a-project)', processRole: 'renderer', pssBytes: 485 * MB }),
		proc({ pid: 3, processName: 'extension-host [1]', processRole: 'extension_host', pssBytes: 468 * MB }),
		proc({ pid: 4, processName: 'gpu-process', processRole: 'gpu', pssBytes: 94 * MB }),
		proc({ pid: 5, processName: 'quarto.quarto (lsp)', processRole: 'language_server', pssBytes: 62 * MB }),
		proc({ pid: 6, processName: 'positron-python (pet)', processRole: 'extension_child', pssBytes: 9 * MB }),
	];
	const output = () => renderMarkdown([snapshot(tree)]);

	test('leaves the skeleton to the role table', () => {
		const top = output().split('### Top processes')[1].split('###')[0];
		expect(top).not.toContain('positron`');
		expect(top).not.toContain('window [1]');
		expect(top).not.toContain('extension-host');
		expect(top).not.toContain('gpu-process');
	});

	test('keeps everything an extension spawned, however small', () => {
		const top = output().split('### Top processes')[1].split('###')[0];
		expect(top).toContain('quarto.quarto (lsp)');
		// 9 MB would never survive a size cut against a 485 MB renderer, and it is
		// exactly the kind of process this section exists to name.
		expect(top).toContain('positron-python (pet)');
	});

	test('says nothing when only skeleton processes are present', () => {
		const skeleton = tree.filter(p => ['main', 'renderer', 'extension_host', 'gpu'].includes(p.processRole));
		expect(renderMarkdown([snapshot(skeleton)])).not.toContain('### Top processes');
	});

	test('still names an unlabeled process, which has no role to fall back on', () => {
		const withMystery = [...tree, proc({ pid: 7, processName: 'something-new', processRole: 'unlabeled', pssBytes: 100 * MB })];
		expect(renderMarkdown([snapshot(withMystery)])).toContain('something-new');
	});
});
