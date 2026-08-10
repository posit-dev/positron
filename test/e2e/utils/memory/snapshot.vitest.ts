/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { isSettled, joinProcesses } from './snapshot.js';
import { RawProcess } from './types.js';

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

	test('a process missing from a later sample still reports from the samples it appears in', () => {
		const samples = [
			[proc(100, 1, 'x', 80), proc(101, 100, 'y', 10)],
			[proc(100, 1, 'x', 80)],
		];
		const joined = joinProcesses(samples[0], names, 100, samples);
		expect(joined.find(p => p.pid === 101)?.pssBytes).toBe(10);
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
