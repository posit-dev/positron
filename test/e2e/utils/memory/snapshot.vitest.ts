/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { isSettled, joinProcesses, unstableProcesses } from './snapshot.js';
import { LabeledProcess, RawProcess } from './types.js';

const proc = (pid: number, ppid: number, cmd: string, pss: number): RawProcess =>
	({ pid, ppid, cmd, pssBytes: pss, rssBytes: pss * 2 });

describe('joinProcesses', () => {
	const raw = [
		proc(100, 1, '/opt/positron/positron', 90),
		proc(101, 100, 'positron --type=gpu-process', 30),
		proc(102, 100, 'positron --type=utility --utility-sub-type=node.mojom.NodeService', 40),
		proc(103, 102, '/opt/positron/kcserver --log-level debug', 20),
	];
	const names = new Map([[100, 'positron'], [101, 'gpu-process'], [102, 'extension-host [1]']]);

	test('applies Positron names and resolves roles', () => {
		const joined = joinProcesses(raw, names, 100, [raw]);
		expect(joined.find(p => p.pid === 102)?.processRole).toBe('extension_host');
		expect(joined.find(p => p.pid === 101)?.processRole).toBe('gpu');
	});

	test('computes depth from ppid, not from any name indentation', () => {
		const joined = joinProcesses(raw, names, 100, [raw]);
		expect(joined.find(p => p.pid === 100)?.depth).toBe(0);
		expect(joined.find(p => p.pid === 102)?.depth).toBe(1);
		expect(joined.find(p => p.pid === 103)?.depth).toBe(2);
	});

	test('marks a process Positron did not name as unlabeled', () => {
		const joined = joinProcesses(raw, names, 100, [raw]);
		const kernel = joined.find(p => p.pid === 103)!;
		expect(kernel.labeled).toBe(false);
		expect(kernel.processRole).toBe('kernel_supervisor');
	});

	test('takes the median across samples and keeps min and max', () => {
		const samples = [
			[proc(100, 1, '/opt/positron/positron', 80)],
			[proc(100, 1, '/opt/positron/positron', 100)],
			[proc(100, 1, '/opt/positron/positron', 90)],
		];
		const joined = joinProcesses(samples[0], names, 100, samples);
		const main = joined.find(p => p.pid === 100)!;
		expect(main.pssBytes).toBe(90);
		expect(main.pssMin).toBe(80);
		expect(main.pssMax).toBe(100);
	});

	test('keeps every sample, so a reader can see the shape rather than a collapsed median', () => {
		const samples = [
			[proc(100, 1, '/opt/positron/positron', 80)],
			[proc(100, 1, '/opt/positron/positron', 100)],
			[proc(100, 1, '/opt/positron/positron', 90)],
		];
		const main = joinProcesses(samples[0], names, 100, samples).find(p => p.pid === 100)!;
		expect(main.pssSamples).toEqual([80, 100, 90]);
		expect(main.rssSamples).toEqual([160, 200, 180]);
	});

	// Regression: pssBytes was the median across samples while rssBytes came from
	// one sample, so a process that moved during sampling published PSS above its
	// own RSS -- impossible for a single instant, and the tell that the number was
	// mid-swing. Both aggregate the same way now.
	test('aggregates rss the same way as pss, so pss never exceeds rss', () => {
		const samples = [
			[proc(100, 1, 'x', 440)],
			[proc(100, 1, 'x', 430)],
			[proc(100, 1, 'x', 306)],
		];
		const main = joinProcesses(samples[0], names, 100, samples).find(p => p.pid === 100)!;
		expect(main.pssBytes).toBe(430);
		expect(main.rssBytes).toBe(860);
		expect(main.pssBytes).toBeLessThanOrEqual(main.rssBytes);
	});

	test('a process missing from a later sample still reports from the samples it appears in', () => {
		const samples = [
			[proc(100, 1, 'x', 80), proc(101, 100, 'y', 10)],
			[proc(100, 1, 'x', 80)],
		];
		const joined = joinProcesses(samples[0], names, 100, samples);
		expect(joined.find(p => p.pid === 101)?.pssBytes).toBe(10);
	});
});

describe('unstableProcesses', () => {
	const MB = 1048576;
	const sampled = (pid: number, pss: number[]): LabeledProcess => ({
		pid, ppid: 1, depth: 0, processName: `p${pid}`, processRole: 'renderer',
		labeled: true, cmdBasename: 'positron',
		pssBytes: pss[Math.floor(pss.length / 2)], rssBytes: 0,
		pssMin: Math.min(...pss), pssMax: Math.max(...pss),
		pssSamples: pss, rssSamples: pss.map(v => v * 2)
	});

	test('flags a process whose samples span more than the tolerance', () => {
		// The real case: the renderer fell ~130 MB between the second and third
		// sample, so the published median described a state it had already left.
		const unstable = unstableProcesses([sampled(1, [439 * MB, 433 * MB, 306 * MB])]);
		expect(unstable.map(p => p.pid)).toEqual([1]);
	});

	test('leaves a settled process alone', () => {
		expect(unstableProcesses([sampled(1, [546 * MB, 546 * MB, 551 * MB])])).toEqual([]);
	});

	// Real numbers from the gpu process, which wobbles ~5 MB on an ~86 MB median in
	// every launch of every scenario. That is 6% -- over a purely relative
	// threshold -- but 5 MB cannot move a 1.9 GB total, and a warning that fires
	// on every run is one nobody reads.
	test('ignores a small process whose wobble is relatively large but absolutely trivial', () => {
		expect(unstableProcesses([sampled(1, [85.3 * MB, 85.4 * MB, 90.8 * MB])])).toEqual([]);
	});

	test('ignores a large process whose spread is absolutely big but relatively tiny', () => {
		// 60 MB on a 3 GB process is under the relative floor: plausible jitter at
		// that scale, not a process that changed state.
		expect(unstableProcesses([sampled(1, [2970 * MB, 3000 * MB, 3030 * MB])])).toEqual([]);
	});

	test('a single sample cannot be judged unstable', () => {
		expect(unstableProcesses([sampled(1, [546 * MB])])).toEqual([]);
	});
});

describe('isSettled', () => {
	const MB = 1048576;

	test('a single reading is never settled', () => {
		expect(isSettled([500 * MB])).toBe(false);
	});

	test('no readings at all is not settled', () => {
		expect(isSettled([])).toBe(false);
	});

	test('three consecutive readings within 1% are settled', () => {
		expect(isSettled([400 * MB, 500 * MB, 501 * MB, 502 * MB, 503 * MB])).toBe(true);
	});

	test('a tree still growing is not settled', () => {
		expect(isSettled([100 * MB, 200 * MB, 300 * MB, 400 * MB])).toBe(false);
	});

	test('a late spike resets the count', () => {
		expect(isSettled([500 * MB, 500 * MB, 500 * MB, 900 * MB])).toBe(false);
	});

	test('a zero total counts as settled, because the root is gone', () => {
		// Previously the zero sentinel meant "no reading yet", so a dead root kept
		// the loop running to the 90s cap while comparing against zero forever.
		expect(isSettled([0])).toBe(true);
		expect(isSettled([500 * MB, 0])).toBe(true);
	});

	test('growth resuming after a plateau is not settled', () => {
		expect(isSettled([500 * MB, 501 * MB, 502 * MB, 700 * MB])).toBe(false);
	});
});
