/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { KERNEL_LABEL_ARK, KERNEL_LABEL_PYTHON, KERNEL_LABEL_UNKNOWN, kernelLabelFor, kernelProcessCounts, kernelTotals } from './kernel.js';
import { LabeledProcess, MemorySnapshot } from './types.js';

const MB = 1024 * 1024;

const proc = (overrides: Partial<LabeledProcess> = {}): LabeledProcess => ({
	pid: 100, ppid: 1, depth: 0, processName: 'positron', processRole: 'main',
	labeled: true, cmdBasename: 'positron', pssBytes: 100 * MB, rssBytes: 200 * MB,
	pssMin: 100 * MB, pssMax: 100 * MB,
	pssSamples: [100 * MB], rssSamples: [200 * MB],
	forcedGc: false,
	...overrides
});

const snapshot = (procs: LabeledProcess[], launchIndex = 0): MemorySnapshot => ({
	scenario: 'session-r', lane: 'desktop', capturedAt: '2026-08-11T00:00:00.000Z',
	positronVersion: '2026.09.0-35', launchIndex, settleMs: 12_000,
	treeTotalPssBytes: procs.reduce((sum, p) => sum + p.pssBytes, 0),
	processes: procs, extensions: []
});

describe('kernelLabelFor', () => {
	// These four expectations are the wire contract with the dashboard's
	// kernel_label_for(): it stores the label it derives, so a disagreement here
	// costs a re-backfill to repair rather than a redeploy.
	test('maps ark to the R kernel label', () => {
		expect(kernelLabelFor('ark')).toBe(KERNEL_LABEL_ARK);
	});

	// The whole point of the prefix match: the runner image's python3.11 becoming
	// python3.12 must not fork one series into two.
	test('maps every python basename to one label', () => {
		expect(kernelLabelFor('python')).toBe(KERNEL_LABEL_PYTHON);
		expect(kernelLabelFor('python3')).toBe(KERNEL_LABEL_PYTHON);
		expect(kernelLabelFor('python3.11')).toBe(KERNEL_LABEL_PYTHON);
		expect(kernelLabelFor('python3.13')).toBe(KERNEL_LABEL_PYTHON);
	});

	// Deliberately not an "other" bucket: a kernel we have never seen shows up
	// the first night it runs, unnamed but visible.
	test('leaves an unmapped basename as itself', () => {
		expect(kernelLabelFor('julia')).toBe('julia');
	});

	test('calls an empty basename unknown, so no row is keyed on a blank', () => {
		expect(kernelLabelFor('')).toBe(KERNEL_LABEL_UNKNOWN);
	});
});

describe('kernelTotals', () => {
	test('sums kernel-role PSS by label', () => {
		const totals = kernelTotals(snapshot([
			proc(),
			proc({ pid: 200, processRole: 'kernel', cmdBasename: 'ark', pssBytes: 180 * MB }),
			proc({ pid: 201, processRole: 'kernel', cmdBasename: 'python3', pssBytes: 90 * MB })
		]));
		expect([...totals]).toEqual([[KERNEL_LABEL_ARK, 180 * MB], [KERNEL_LABEL_PYTHON, 90 * MB]]);
	});

	test('folds two processes sharing a label into one figure', () => {
		const totals = kernelTotals(snapshot([
			proc({ pid: 200, processRole: 'kernel', cmdBasename: 'python3', pssBytes: 90 * MB }),
			proc({ pid: 201, processRole: 'kernel', cmdBasename: 'python3.11', pssBytes: 60 * MB })
		]));
		expect(totals.get(KERNEL_LABEL_PYTHON)).toBe(150 * MB);
	});

	// Restricting to `kernel` is what keeps these figures summing to a band the
	// dashboard already shows. kcserver and the language servers are adjacent
	// roles with their own rows in the role table.
	test('excludes the supervisor and language-server roles', () => {
		const totals = kernelTotals(snapshot([
			proc({ pid: 200, processRole: 'kernel_supervisor', cmdBasename: 'kcserver', pssBytes: 30 * MB }),
			proc({ pid: 201, processRole: 'language_server', cmdBasename: 'ruff', pssBytes: 20 * MB })
		]));
		expect(totals.size).toBe(0);
	});

	test('is empty for a scenario that starts no kernel', () => {
		expect(kernelTotals(snapshot([proc()])).size).toBe(0);
	});
});

describe('kernelProcessCounts', () => {
	test('counts the processes one label covers', () => {
		const counts = kernelProcessCounts([snapshot([
			proc({ pid: 200, processRole: 'kernel', cmdBasename: 'python3' }),
			proc({ pid: 201, processRole: 'kernel', cmdBasename: 'python3.11' }),
			proc({ pid: 202, processRole: 'kernel', cmdBasename: 'ark' })
		])]);
		expect(counts.get(KERNEL_LABEL_PYTHON)).toBe(2);
		expect(counts.get(KERNEL_LABEL_ARK)).toBe(1);
	});

	// The max rather than the median or the first launch: the column exists to
	// warn that a figure is a sum, and a launch that spawned a second kernel is
	// exactly what a reader needs told.
	test('takes the highest count across launches', () => {
		const counts = kernelProcessCounts([
			snapshot([proc({ pid: 200, processRole: 'kernel', cmdBasename: 'ark' })], 0),
			snapshot([
				proc({ pid: 200, processRole: 'kernel', cmdBasename: 'ark' }),
				proc({ pid: 201, processRole: 'kernel', cmdBasename: 'ark' })
			], 1)
		]);
		expect(counts.get(KERNEL_LABEL_ARK)).toBe(2);
	});
});
