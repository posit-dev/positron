/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { byRole, extensionHeapRows, formatBytes, kernelRows, renderHtml, renderMarkdown } from './render.js';
import { REPORT_CSS } from './report-shell.js';
import { ActivatedExtension, ExtensionHeapBreakdown, ExtensionHeapStatus, LabeledProcess, MemorySnapshot } from './types.js';

const MB = 1024 * 1024;

const proc = (overrides: Partial<LabeledProcess> = {}): LabeledProcess => ({
	pid: 100, ppid: 1, depth: 0, processName: 'positron', processRole: 'main',
	labeled: true, cmdBasename: 'positron', pssBytes: 100 * MB, rssBytes: 200 * MB,
	pssMin: 100 * MB, pssMax: 100 * MB,
	pssSamples: [100 * MB, 100 * MB, 100 * MB], rssSamples: [200 * MB, 200 * MB, 200 * MB],
	forcedGc: false,
	...overrides
});

/** A process caught mid-swing, as session-python's renderer was: median 433 MB over a 130 MB drop. */
const movingProc = (overrides: Partial<LabeledProcess> = {}): LabeledProcess => proc({
	processName: 'window [1]', processRole: 'renderer',
	pssBytes: 433 * MB, rssBytes: 508 * MB, pssMin: 306 * MB, pssMax: 439 * MB,
	pssSamples: [439 * MB, 433 * MB, 306 * MB], rssSamples: [514 * MB, 508 * MB, 381 * MB],
	...overrides
});

const ext = (extensionId: string, activationEvent: string | null): ActivatedExtension =>
	({ extensionId, isBuiltin: true, activationTimeMs: null, activationEvent });

const snapshot = (procs: LabeledProcess[], launchIndex = 0, extensions: ActivatedExtension[] = []): MemorySnapshot => ({
	scenario: 'idle', lane: 'desktop', capturedAt: '2026-08-11T00:00:00.000Z',
	positronVersion: '2026.09.0-35', launchIndex, settleMs: 12_000,
	treeTotalPssBytes: procs.reduce((sum, p) => sum + p.pssBytes, 0),
	processes: procs, extensions
});

/** The existing factory takes no overrides, so the new field is spread on. */
const withHeap = (extensionHeap?: ExtensionHeapBreakdown, extensionHeapStatus?: ExtensionHeapStatus): MemorySnapshot =>
	({ ...snapshot([proc()]), extensionHeap, extensionHeapStatus });

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

	// Every launch spends its first 10-25s on a startup plateau that is flat enough
	// to look settled but sits hundreds of MB high, so a reader has to be able to
	// see that it was excluded rather than take it on faith.
	test('says how much of the sampling window was discarded as startup', () => {
		const output = renderMarkdown([{ ...snapshot([proc()]), sampledMs: 40_000, discardedSamples: 5 }]);
		expect(output).toContain('Median of 1 launches, settled in 12s, sampled for 40s, discarding 5 startup samples.');
	});

	// The median of an odd spread of counts is fractional: launches discarding 5
	// and 6 samples average to 5.5, and "discarding 5.5 startup samples" is not a
	// thing that can have happened.
	test('rounds a fractional median sample count', () => {
		const output = renderMarkdown([
			{ ...snapshot([proc()]), sampledMs: 40_000, discardedSamples: 5 },
			{ ...snapshot([proc()]), sampledMs: 40_000, discardedSamples: 6 }
		]);
		expect(output).toContain('discarding 6 startup samples');
		expect(output).not.toContain('5.5');
	});

	test('omits the sampling detail for a baseline snapshot that never recorded it', () => {
		expect(renderMarkdown([snapshot([proc()])])).toContain('Median of 1 launches, settled in 12s.');
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

	// "no baseline vs previous nightly" parsed as a value followed by a comparison.
	// With nothing to compare against there is nothing to say, so the line goes.
	test('omits the comparison line entirely when there is no baseline', () => {
		expect(renderHtml([snapshot([proc()])])).not.toContain('vs previous nightly');
	});

	test('shows the comparison line when a baseline exists', () => {
		const html = renderHtml([snapshot([proc({ pssBytes: 150 * MB })])], snapshot([proc({ pssBytes: 100 * MB })]));
		expect(html).toContain('vs previous nightly');
	});

	test('shows the GC note only when a snapshot carries a forced-GC reading', () => {
		expect(renderHtml([snapshot([proc()])])).not.toContain('forced garbage collection');

		const gcSnapshot = { ...snapshot([proc()]), forcedGc: [{ role: 'extension_host' as const, pid: 1, preRssBytes: 1, postRssBytes: 1, preHeapTotalBytes: 1, postHeapTotalBytes: 1 }] };
		expect(renderHtml([gcSnapshot])).toContain('forced garbage collection');
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

	test('titles and heads the document with its lane, not just the scenario', () => {
		// desktop-idle.html and server-idle.html land in the same S3 directory.
		// Without the lane in the document itself, both open as a page headed
		// only "idle" and a reader cannot tell which is which.
		const desktop = renderHtml([snapshot([proc()])]);
		expect(desktop).toContain('<title>Positron memory: desktop idle</title>');
		expect(desktop).toContain('<h1>desktop idle</h1>');

		const server = renderHtml([{ ...snapshot([proc()]), lane: 'server' as const }]);
		expect(server).toContain('<title>Positron memory: server idle</title>');
		expect(server).toContain('<h1>server idle</h1>');
	});

	// The report published a renderer median of 433 MB for a process that was at
	// 306 MB when sampling ended, and said nothing about it. A number taken from
	// the middle of a swing has to announce itself, or it reads as steady state.
	test('warns when a process moved too much for its median to be a steady state', () => {
		const output = renderHtml([snapshot([proc(), movingProc()])]);
		expect(output).toContain('Not a steady state');
		expect(output).toContain('window [1]');
		expect(output).toContain('306.0 MB');
		expect(output).toContain('439.0 MB');
	});

	test('says nothing about stability when every process settled', () => {
		const output = renderHtml([snapshot([proc()])]);
		expect(output).not.toContain('Not a steady state');
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
			// process name) between the `style` and the closing `>`, and the name
			// itself sits inside a `<code>`, so the match can't assume `px"` is
			// immediately followed by the name.
			const match = output.match(new RegExp(`padding-left:(\\d+)px"[^>]*><code>${name}`));
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
		const cellText = row.match(/<td class="tree-name"[^>]*><code>([^<]*)<\/code>/)![1];
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

	test('renders a delta with a glyph, not color alone', () => {
		const current = snapshot([proc({ pssBytes: 150 * MB })]);
		const baseline = snapshot([proc({ pssBytes: 100 * MB })]);
		const output = renderHtml([current], baseline);
		expect(output).toMatch(/&#9650;[^<]*50\.0 MB/);
	});

	test('renders a decrease with the down glyph, the only thing marking direction', () => {
		const current = snapshot([proc({ pssBytes: 80 * MB })]);
		const baseline = snapshot([proc({ pssBytes: 100 * MB })]);
		const output = renderHtml([current], baseline);
		expect(output).toMatch(/&#9660;[^<]*20\.0 MB/);
		expect(output).not.toMatch(/&#9660;[^<]*-20\.0 MB/);
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

	test('groups eagerly activated extensions by activation event', () => {
		const output = renderHtml([snapshot([proc()], 0, [
			ext('github.copilot', 'onStartupFinished'),
			ext('posit.assistant', '*'),
		])]);
		expect(output).toContain('onStartupFinished');
		expect(output).toContain('github.copilot');
		expect(output).toContain('posit.assistant');
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
		expect(treeSection(output)).toMatch(/quarto\.quarto \(lsp\)[\s\S]*&#9650;[^<]*20\.0 MB/);
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
		const cellText = card.match(/<td class="tree-name"[^>]*><code>([^<]*)<\/code>/)![1];
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
		// The second arm the name promises: a baseline exists and every current
		// process matches it, so there is nothing new to report.
		expect(renderHtml([snapshot([proc()])], snapshot([proc()]))).not.toContain('New since the previous nightly');
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

	// `*` is a real activationEvents value but says nothing about itself, and as a
	// heading followed by a count it reads as a footnote marker rather than an id.
	// `onStartupFinished` needs no such help, which is why only one is titled.
	test('titles the cryptic `*` event, keeping the literal only in a tooltip', () => {
		const card = renderHtml([snapshot([proc()], 0, [ext('vscode.git', '*')])])
			.split('<h2>Activated extensions')[1];
		expect(card).toContain('During startup');
		// Inline, the literal needed a gloss to stop reading as a footnote marker,
		// which left this heading shaped unlike the other one.
		expect(card.split('</h3>')[0]).not.toContain('<code>*</code>');
		expect(card).toContain('title="activationEvents: *"');
	});

	test('leaves a self-describing event name as it is', () => {
		const card = renderHtml([snapshot([proc()], 0, [ext('posit.assistant', 'onStartupFinished')])])
			.split('<h2>Activated extensions')[1];
		expect(card).toContain('<code>onStartupFinished</code>');
		expect(card).not.toContain('During startup');
	});

	// The badge marked every group in the card, since only eager groups are listed.
	// A label on all of them says nothing, and it read as a half-finished
	// definition of "eager" next to the one group that carried a note.
	test('does not badge the groups, having only eager ones to show', () => {
		const card = renderHtml([snapshot([proc()], 0, [
			ext('vscode.git', '*'),
			ext('posit.assistant', 'onStartupFinished'),
		])]).split('<h2>Activated extensions')[1];
		expect(card).not.toContain('eager<');
		expect(card).not.toContain('&#9889;');
	});

	test('says what eager activation costs, once, above the groups', () => {
		const output = renderHtml([snapshot([proc()], 0, [ext('vscode.git', '*')])]);
		expect(output).toContain('cost memory in every window');
	});

	// The demand-activated groups were 25 of 27 headings and over half the page
	// height, all of it below the actionable part. The eager groups are what the
	// headline count and the "Newly eager" callout are both about.
	test('lists the eager groups in full and collapses the demand-activated tail to a count', () => {
		const output = renderHtml([snapshot([proc()], 0, [
			ext('github.copilot', 'onStartupFinished'),
			ext('posit.assistant', '*'),
			ext('ms-python.python', 'onLanguage:python'),
			ext('vscode.git', 'workspaceContains:.git'),
			ext('quarto.quarto', 'onLanguage:qmd'),
		])]);
		expect(output).toContain('github.copilot');
		expect(output).toContain('posit.assistant');
		expect(output).toContain('3 further extensions activated on demand');
		// Neither the ids nor their group headings survive the collapse.
		expect(output).not.toContain('ms-python.python');
		expect(output).not.toContain('onLanguage:python');
	});

	test('says nothing about a tail that does not exist', () => {
		const output = renderHtml([snapshot([proc()], 0, [ext('posit.assistant', '*')])]);
		expect(output).not.toContain('activated on demand');
	});

	test('uses the singular for a tail of one', () => {
		const output = renderHtml([snapshot([proc()], 0, [
			ext('posit.assistant', '*'),
			ext('ms-python.python', 'onLanguage:python'),
		])]);
		expect(output).toContain('1 further extension activated on demand');
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

describe('extension host heap breakdown', () => {
	const breakdown = {
		extensions: [
			{ extensionId: 'GitHub.copilot-chat', retainedBytes: 120_500_000 },
			{ extensionId: 'positron.positron-python', retainedBytes: 37_600_000 },
			{ extensionId: 'vscode.authentication', retainedBytes: 2_800_000 },
			{ extensionId: 'vscode.tiny-one', retainedBytes: 400_000 },
			{ extensionId: 'vscode.tiny-two', retainedBytes: 300_000 }
		],
		unattributedBytes: 192_800_000,
		reachableBytes: 354_400_000
	};

	test('lists extensions above the floor, collapses the rest, and ends with unattributed then TOTAL', () => {
		const rows = extensionHeapRows([withHeap(breakdown)]);

		expect(rows.map(r => r.extensionId)).toEqual([
			'GitHub.copilot-chat',
			'positron.positron-python',
			'vscode.authentication',
			'(2 others)',
			'unattributed',
			'TOTAL'
		]);
		expect(rows.find(r => r.extensionId === '(2 others)')?.bytes).toBe(700_000);
	});

	test('TOTAL is the rows above it added up, so the printed column adds up', () => {
		const rows = extensionHeapRows([withHeap(breakdown)]);

		// unattributed is a slice of the partition like any other row, not the
		// summary line its position and old styling made it look like.
		const total = rows.find(r => r.extensionId === 'TOTAL')!;
		const parts = rows.filter(r => r.extensionId !== 'TOTAL');
		expect(total.bytes).toBe(parts.reduce((sum, row) => sum + row.bytes, 0));
	});

	test('reports change against the baseline, and "new" for an extension the baseline lacked', () => {
		const baseline = withHeap({
			extensions: [{ extensionId: 'GitHub.copilot-chat', retainedBytes: 120_192_800 }],
			unattributedBytes: 189_200_000,
			reachableBytes: 309_400_000
		});

		const rows = extensionHeapRows([withHeap(breakdown)], baseline);

		expect(rows.find(r => r.extensionId === 'GitHub.copilot-chat')?.change).toBe('+300.0 KB');
		expect(rows.find(r => r.extensionId === 'positron.positron-python')?.change).toBe('new');
	});

	/** Same three extensions as `breakdown`: one up 300 KB, one down 300.4 KB, one unmoved. */
	const movedBaseline = withHeap({
		extensions: [
			{ extensionId: 'GitHub.copilot-chat', retainedBytes: 120_192_800 },
			{ extensionId: 'positron.positron-python', retainedBytes: 37_907_600 },
			{ extensionId: 'vscode.authentication', retainedBytes: 2_800_000 }
		],
		unattributedBytes: 192_800_000,
		reachableBytes: 353_701_200
	});

	test('renders an unchanged extension as flat rather than as a rise', () => {
		const row = extensionHeapRows([withHeap(breakdown)], movedBaseline)
			.find(r => r.extensionId === 'vscode.authentication');

		expect(row?.change).toBe('+0.0 KB');
		expect(row?.changeBytes).toBe(0);
		expect(renderHtml([withHeap(breakdown)], movedBaseline)).toContain('<span class="delta-flat">+0.0 KB</span>');
	});

	test('gives the html change cell the same glyph and classes as the role table', () => {
		const html = renderHtml([withHeap(breakdown)], movedBaseline);

		expect(html).toContain('<span class="delta-up">&#9650; 300.0 KB</span>');
		expect(html).toContain('<span class="delta-down">&#9660; 300.4 KB</span>');
		// The role table marks an unmatched row this way too.
		expect(renderHtml([withHeap(breakdown)], withHeap({
			extensions: [], unattributedBytes: 192_800_000, reachableBytes: 192_800_000
		}))).toContain('<span class="delta-flat">new</span>');
	});

	test('leaves change blank when there is no baseline at all', () => {
		const rows = extensionHeapRows([withHeap(breakdown)]);

		expect(rows.every(r => r.change === '')).toBe(true);
	});

	test('leaves change blank when the baseline predates the breakdown', () => {
		const rows = extensionHeapRows([withHeap(breakdown)], withHeap());

		expect(rows.every(r => r.change === '')).toBe(true);
	});

	test('takes the median across launches, zero-filling a launch that lacked an extension', () => {
		const withOnlyCopilot = {
			extensions: [{ extensionId: 'GitHub.copilot-chat', retainedBytes: 120_500_000 }],
			unattributedBytes: 192_800_000,
			reachableBytes: 313_300_000
		};
		const rows = extensionHeapRows([
			withHeap(breakdown),
			withHeap(withOnlyCopilot),
			withHeap(withOnlyCopilot)
		]);

		expect(rows.find(r => r.extensionId === 'GitHub.copilot-chat')?.bytes).toBe(120_500_000);
		// Present in one launch of three, so its median is zero and it falls below
		// the floor rather than reading as heavy as something present in all three.
		expect(rows.map(r => r.extensionId)).not.toContain('positron.positron-python');
	});

	test('renders no table, and falls back to the bare sentence for a run carrying no status', () => {
		const markdown = renderMarkdown([withHeap()]);

		expect(markdown).not.toContain('Extension host heap');
		expect(markdown).toContain('Per-extension breakdown unavailable for this run._');
	});

	test('falls back to the bare sentence in html too, rather than dropping the card silently', () => {
		const html = renderHtml([withHeap()]);

		expect(html).toContain('Per-extension breakdown unavailable for this run.</p>');
		expect(html).not.toContain('<th>Extension</th>');
	});

	test('markdown names the failure that cost the breakdown', () => {
		expect(renderMarkdown([withHeap(undefined, 'capture_failed')]))
			.toContain('The extension host inspector did not produce a heap snapshot.');
		expect(renderMarkdown([withHeap(undefined, 'untrusted')]))
			.toContain('unresolved script id');
	});

	test('html names the failure that cost the breakdown', () => {
		expect(renderHtml([withHeap(undefined, 'parse_failed')]))
			.toContain('The heap snapshot was captured but could not be read back.');
		expect(renderHtml([withHeap(undefined, 'unsupported_format')]))
			.toContain('not in the format this parser understands');
	});

	test('renders the table in markdown when a breakdown is present', () => {
		const markdown = renderMarkdown([withHeap(breakdown)]);

		expect(markdown).toContain('### Extension host heap');
		expect(markdown).toContain('`GitHub.copilot-chat`');
		expect(markdown).toContain('_unattributed_');
	});

	test('renders the table in html when a breakdown is present', () => {
		const html = renderHtml([withHeap(breakdown)]);

		expect(html).toContain('Extension host heap');
		expect(html).toContain('GitHub.copilot-chat');
	});
});

describe('kernelRows', () => {
	const kernelProc = (cmdBasename: string, pssBytes: number, pid: number): LabeledProcess =>
		proc({ pid, processRole: 'kernel', processName: cmdBasename, cmdBasename, pssBytes });

	test('ranks the labels largest first', () => {
		const rows = kernelRows([snapshot([
			proc(),
			kernelProc('python3', 90 * MB, 200),
			kernelProc('ark', 180 * MB, 201)
		])]);

		expect(rows.map(row => row.label)).toEqual(['R (ark)', 'Python', 'TOTAL']);
		expect(rows[0].bytes).toBe(180 * MB);
	});

	// The same zero-filling byRole does, and for the same reason: a kernel that
	// appeared in one launch of three must not read as heavy as one that ran in
	// all three.
	test('counts a label absent from a launch as zero in the median', () => {
		const rows = kernelRows([
			snapshot([kernelProc('ark', 90 * MB, 200)], 0),
			snapshot([], 1),
			snapshot([], 2)
		]);

		expect(rows.find(row => row.label === 'R (ark)')!.bytes).toBe(0);
	});

	test('says how many processes a label folds together', () => {
		const rows = kernelRows([snapshot([
			kernelProc('python3', 90 * MB, 200),
			kernelProc('python3.11', 60 * MB, 201)
		])]);

		expect(rows[0]).toMatchObject({ label: 'Python', bytes: 150 * MB, processCount: 2 });
	});

	// With one label the TOTAL is that label's figure printed twice, which says
	// nothing and invites the reader to look for the difference.
	test('omits the TOTAL row for a single label', () => {
		const rows = kernelRows([snapshot([kernelProc('ark', 90 * MB, 200)])]);

		expect(rows.map(row => row.label)).toEqual(['R (ark)']);
	});

	test('sums the TOTAL from the printed rows', () => {
		const rows = kernelRows([snapshot([
			kernelProc('ark', 180 * MB, 200),
			kernelProc('python3', 90 * MB, 201)
		])]);

		expect(rows.at(-1)).toMatchObject({ label: 'TOTAL', bytes: 270 * MB, isTotal: true });
	});

	test('is empty for a scenario that starts no kernel', () => {
		expect(kernelRows([snapshot([proc()])])).toEqual([]);
	});

	test('reports a change against the previous nightly', () => {
		const rows = kernelRows(
			[snapshot([kernelProc('ark', 180 * MB, 200)])],
			snapshot([kernelProc('ark', 160 * MB, 200)]));

		expect(rows[0]).toMatchObject({ change: '+20.0 MB', changeBytes: 20 * MB });
	});

	// A kernel the previous nightly did not run is a different fact from one that
	// held flat, so it says so rather than reporting its whole figure as growth.
	test('calls a label the baseline never had new', () => {
		const rows = kernelRows(
			[snapshot([kernelProc('ark', 180 * MB, 200)])],
			snapshot([kernelProc('python3', 90 * MB, 200)]));

		const row = rows.find(entry => entry.label === 'R (ark)')!;
		expect(row.change).toBe('new');
		expect(row.changeBytes).toBeUndefined();
	});

	// Blank rather than "new" on every row: a baseline with no kernel at all is
	// the first night, or an idle baseline, not a night the kernels appeared.
	test('leaves the change blank when the baseline had no kernel', () => {
		const rows = kernelRows([snapshot([kernelProc('ark', 180 * MB, 200)])], snapshot([proc()]));

		expect(rows[0].change).toBe('');
	});

	// The alarm for our label mapping drifting from the dashboard's: it sums the
	// kernel band the same way, so if a basename stops being counted here it has
	// stopped being counted there too. Single launch, where a median is exact --
	// across launches the per-label medians need not sum to the role's own median.
	test('sums to the kernel row in the role table', () => {
		const snapshots = [snapshot([
			proc(),
			kernelProc('ark', 180 * MB, 200),
			kernelProc('python3.11', 90 * MB, 201),
			kernelProc('julia', 40 * MB, 202)
		])];

		const total = kernelRows(snapshots).find(row => row.isTotal)!.bytes;
		expect(total).toBe(byRole(snapshots).get('kernel'));
	});
});

describe('kernel card', () => {
	const sessionSnapshot = snapshot([
		proc(),
		proc({ pid: 200, processRole: 'kernel', processName: 'ark', cmdBasename: 'ark', pssBytes: 180 * MB })
	]);

	test('renders the labels in html', () => {
		const html = renderHtml([sessionSnapshot]);

		expect(html).toContain('Kernel memory');
		expect(html).toContain('R (ark)');
	});

	// The count column warns that a label's figure is a sum; TOTAL says that
	// about itself, and the suffix there only reads as a second figure.
	test('leaves the process count off the TOTAL row', () => {
		const html = renderHtml([snapshot([
			proc({ pid: 200, processRole: 'kernel', processName: 'ark', cmdBasename: 'ark', pssBytes: 180 * MB }),
			proc({ pid: 201, processRole: 'kernel', processName: 'python3', cmdBasename: 'python3', pssBytes: 90 * MB })
		])]);

		expect(html).not.toContain('<strong>TOTAL</strong> <span class="muted">(2 processes)');
	});

	// idle, editors and data-explorer start no session, and an empty table there
	// reads as a failed measurement rather than as a scenario without a kernel.
	test('omits the card entirely when no kernel ran', () => {
		expect(renderHtml([snapshot([proc()])])).not.toContain('Kernel memory');
	});

	test('renders the labels in markdown', () => {
		const markdown = renderMarkdown([sessionSnapshot]);

		expect(markdown).toContain('### Kernel memory');
		expect(markdown).toContain('R (ark)');
	});

	test('omits the markdown section when no kernel ran', () => {
		expect(renderMarkdown([snapshot([proc()])])).not.toContain('### Kernel memory');
	});
});
