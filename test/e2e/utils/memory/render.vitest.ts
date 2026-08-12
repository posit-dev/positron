/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { formatBytes, renderHtml, renderMarkdown } from './render.js';
import { REPORT_CSS } from './report-shell.js';
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
	test('stays in MB above 1024 MB, with a thousands separator', () => {
		// Regression: a GB branch collapses exactly the resolution the report
		// exists to show. At gigabyte scale, one displayed digit is worth over
		// 100 MB -- bigger than the duckdb-worker regression (86 MB) this whole
		// effort exists to catch.
		expect(formatBytes(2059 * MB)).toBe('2,059.0 MB');
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
			// The name cell also carries a `title` attribute (the untruncated
			// process name) between the `style` and the closing `>`, so the match
			// can't assume `px"` is immediately followed by `>`.
			const match = output.match(new RegExp(`padding-left:(\\d+)px"[^>]*>${name}`));
			expect(match).not.toBeNull();
			return Number(match![1]);
		};
		expect(indent('positron')).toBeLessThan(indent('extension-host \\[1\\]'));
		expect(indent('extension-host \\[1\\]')).toBeLessThan(indent('kcserver'));
	});

	test('truncates a very long process name but keeps the full name in a title attribute', () => {
		// Regression: a real process name (the supervisor wrapper script's
		// command line) is 465 characters long. Combined with `.tree-name`'s
		// `nowrap`, an untruncated name pushes every numeric column off the
		// card, so the tree shows no memory values at all.
		const longName = 'bash /__w/_temp/positron-build/positron-linux/resources/app/extensions/positron-supervisor/resources/supervisor-wrapper.sh /tmp/kallichore-1234567890.log --some-flag --another-flag --and-another-one-for-good-measure --keep-going';
		const output = renderHtml([snapshot([proc({ processName: longName })])]);
		const row = output.split('Process tree')[1].split('</table>')[0];
		expect(row).toContain(`title="${longName}"`);
		const cellText = row.match(/<td class="tree-name"[^>]*>([^<]*)<\/td>/)![1];
		expect(cellText.length).toBeLessThan(longName.length);
		expect(cellText.length).toBeLessThan(80);
	});

	test('escapes both the truncated name and the full title so a command line cannot inject markup', () => {
		const longName = `${'a'.repeat(70)} <script>alert(1)</script>`;
		const output = renderHtml([snapshot([proc({ processName: longName })])]);
		expect(output).not.toContain('<script>alert(1)</script>');
		expect(output).toContain('&lt;script&gt;');
	});

	test('orders the tree depth-first, a parent immediately followed by its own children', () => {
		// Regression: rows used to follow the snapshot's raw array order, so a
		// child could land far from the parent that spawned it even though the
		// indentation depths were correct.
		const zygote = proc({ pid: 1, ppid: 0, depth: 0, processName: 'zygote', processRole: 'zygote' });
		const ptyHost = proc({ pid: 2, ppid: 1, depth: 1, processName: 'pty-host', processRole: 'pty_host' });
		const window1 = proc({ pid: 3, ppid: 1, depth: 1, processName: 'window [1]', processRole: 'renderer' });
		// Array order deliberately puts pty-host between the zygote and its
		// other child, which is the exact bug this test guards against.
		const output = renderHtml([snapshot([zygote, ptyHost, window1])]);
		const treeSection = output.split('Process tree')[1].split('</table>')[0];
		expect(treeSection.indexOf('zygote')).toBeLessThan(treeSection.indexOf('pty-host'));
		expect(treeSection.indexOf('zygote')).toBeLessThan(treeSection.indexOf('window [1]'));
	});

	test('orders siblings biggest PSS first', () => {
		const root = proc({ pid: 1, ppid: 0, depth: 0, processName: 'root' });
		const small = proc({ pid: 2, ppid: 1, depth: 1, processName: 'small-child', pssBytes: 10 * MB });
		const big = proc({ pid: 3, ppid: 1, depth: 1, processName: 'big-child', pssBytes: 200 * MB });
		const output = renderHtml([snapshot([root, small, big])]);
		const treeSection = output.split('Process tree')[1].split('</table>')[0];
		expect(treeSection.indexOf('big-child')).toBeLessThan(treeSection.indexOf('small-child'));
	});

	test('still shows a process whose parent is missing from the snapshot, as an orphan', () => {
		// The parent may not have been captured (e.g. it already exited). The
		// orphan must not silently disappear from the report.
		const root = proc({ pid: 1, ppid: 0, depth: 0, processName: 'root' });
		const orphan = proc({ pid: 99, ppid: 12345, depth: 1, processName: 'orphaned-worker' });
		const output = renderHtml([snapshot([root, orphan])]);
		expect(output).toContain('orphaned-worker');
	});

	test('does not infinite-loop on a cycle in the parent/child data', () => {
		const a = proc({ pid: 1, ppid: 2, depth: 0, processName: 'proc-a' });
		const b = proc({ pid: 2, ppid: 1, depth: 1, processName: 'proc-b' });
		expect(() => renderHtml([snapshot([a, b])])).not.toThrow();
		const output = renderHtml([snapshot([a, b])]);
		expect(output).toContain('proc-a');
		expect(output).toContain('proc-b');
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

	test('marks the tree\'s PSS, RSS, PID and Change cells so a value can never split across lines', () => {
		// Regression: PSS/RSS values wrapped onto two lines ("168.0" then "MB"),
		// doubling every row's height, and the Change column was clipped off the
		// card entirely. Both header and data cells need the nowrap treatment.
		const current = snapshot([proc({ pssBytes: 150 * MB })]);
		const baseline = snapshot([proc({ pssBytes: 100 * MB })]);
		const output = renderHtml([current], baseline);
		const treeSection = output.split('Process tree')[1].split('</table>')[0];
		const numCells = [...treeSection.matchAll(/<t[hd] class="num-cell"/g)];
		// One header row (PSS, RSS, PID, Change) plus one data row of the same
		// four columns.
		expect(numCells.length).toBeGreaterThanOrEqual(8);
		expect(REPORT_CSS).toMatch(/\.num-cell\s*\{[^}]*white-space:\s*nowrap/);
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
		expect(tree).toMatch(/<td class="num-cell" align="right"><\/td>\s*<\/tr>/);
	});

	test('calls out a process that is new since the baseline', () => {
		const current = snapshot([proc(), proc({ pid: 200, processName: 'duckdb-worker', processRole: 'unlabeled', pssBytes: 100 * MB })]);
		const baseline = snapshot([proc()]);
		const output = renderHtml([current], baseline);
		expect(output).toContain('duckdb-worker');
		expect(output.toLowerCase()).toContain('new since the previous nightly');
	});

	test('truncates a long process name in the new-since card but keeps the full name in a title', () => {
		// Regression: this card rendered the full 465-char supervisor-wrapper
		// command line untruncated, wrapping over six lines and dominating the
		// card -- the truncation added to the tree was never applied here.
		const longName = 'bash /__w/_temp/positron-build/positron-linux/resources/app/extensions/positron-supervisor/resources/supervisor-wrapper.sh /tmp/kallichore-1234567890.log --some-flag --another-flag --and-another-one-for-good-measure --keep-going';
		const current = snapshot([proc(), proc({ pid: 200, processName: longName, processRole: 'unlabeled', pssBytes: 100 * MB })]);
		const baseline = snapshot([proc()]);
		const output = renderHtml([current], baseline);
		const card = output.split('New since the previous nightly')[1].split('</table>')[0];
		expect(card).toContain(`title="${longName}"`);
		const cellText = card.match(/<td class="tree-name"[^>]*>([^<]*)<\/td>/)![1];
		expect(cellText.length).toBeLessThan(longName.length);
		expect(cellText.length).toBeLessThan(80);
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

	test('lists extensions once, in a single merged card', () => {
		// Regression: there used to be a separate "Eagerly activated extensions"
		// card whose groups were entirely a subset of the "Activated extensions"
		// card below it -- the same ids listed twice.
		const output = renderHtml([snapshot([proc()], 0, [
			ext('github.copilot', 'onStartupFinished'),
			ext('ms-python.python', 'onLanguage:python'),
		])]);
		expect(output).not.toContain('Eagerly activated extensions');
		expect(output.match(/github\.copilot/g)).toHaveLength(1);
	});

	test('badges the eager groups but not demand-activated ones', () => {
		const output = renderHtml([snapshot([proc()], 0, [
			ext('github.copilot', 'onStartupFinished'),
			ext('ms-python.python', 'onLanguage:python'),
			ext('vscode.git', 'workspaceContains:.git'),
		])]);
		const card = output.split('<h2>Activated extensions')[1];
		const eagerGroup = card.split('onStartupFinished')[1].split('</h3>')[0];
		const demandGroup = card.split('onLanguage:python')[1].split('</h3>')[0];
		expect(eagerGroup).toContain('eager');
		expect(demandGroup).not.toContain('eager');
	});

	test('reports the headline count of eagerly activated extensions', () => {
		const output = renderHtml([snapshot([proc()], 0, [
			ext('github.copilot', 'onStartupFinished'),
			ext('posit.assistant', '*'),
			ext('ms-python.python', 'onLanguage:python'),
			ext('vscode.git', 'workspaceContains:.git'),
		])]);
		expect(output).toContain('2 of 4</strong> activate eagerly');
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

	// The tree once rendered 7 columns wider than its 960px card, pushing the
	// Change column off the right edge. The fix is structural: a fixed-layout
	// table whose colgroup sizes every column except the name, so the name
	// absorbs the slack and ellipsizes. Only a browser can confirm the visual
	// result; this guards the structure the fix depends on.
	test('sizes every tree column except the name, so the name absorbs the slack', () => {
		const output = renderHtml([snapshot([proc()])]);
		const colgroup = output.match(/<colgroup>.*?<\/colgroup>/s);
		expect(colgroup).not.toBeNull();
		expect(output).toContain('class="tree-table"');
		// One bare <col> (the name) and six sized ones: role, PSS, bar, RSS, PID, Change.
		expect(colgroup![0].match(/<col>/g)).toHaveLength(1);
		expect(colgroup![0].match(/<col style="width:/g)).toHaveLength(6);
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
